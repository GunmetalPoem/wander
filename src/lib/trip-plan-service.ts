import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  TripPlanSchema,
  type TripDay,
  type TripFormInput,
  type TripPlan,
  type TripStop,
  defaultTripForm,
  normalizeTripJsonPayload,
} from "@/lib/trip-schema";
import {
  geocodeStops,
  getGoogleGeoKeyFromEnv,
  refineTripPlanWithMapbox,
  resolveCityContext,
  type ResolvedCityContext,
} from "@/lib/trip-geocode";
import { enrichStops, enrichTripPlan } from "@/lib/trip-enrich";
import { fetchTripWeather, type TripWeather } from "@/lib/weather";
import { optimizeTripPlanForCloseness } from "@/lib/trip-optimize";

const SYSTEM_RULES = `You are a travel planner API. You output ONLY valid JSON describing each day of a trip — see the per-line format below.

For every stop, return null for "lat" and "lng" (do not guess coordinates). Each stop schema:
{
  "id": "unique_id",
  "name": "Place or venue name (exact as people search for it)",
  "address": "Full street address or best-known address string for the place and city",
  "lat": null,
  "lng": null,
  "category": "outdoor|foodie|art|history|...",
  "duration_minutes": 45,
  "best_time": "early_morning|morning|midday|afternoon|evening|night",
  "description": "2-4 sentences: why visit, what to do",
  "transition_to_next": "How to get to the next stop or end",
  "travel_minutes_to_next": 10
}

Rules:
- 3-8 stops per day depending on pace: packed=more, relaxed=fewer.
- Each stop's "id" must be unique across the whole trip.
- Use real, verifiable places. Descriptions must be specific and useful, not generic.
- If the city is ambiguous, pick the well-known one (e.g. "SF" = San Francisco, USA).
- If the user prompt lists places to never include, do not add those venues (or obvious substitutes) to any day.

Geography & route shape (critical):
- List stops in an order you could actually walk or drive without crossing the city repeatedly: each next stop near the previous cluster (same neighborhood or adjacent), not "east → west → east again".
- For walking transport especially: stay within 1–3 contiguous areas per day unless a rare must-see justifies a longer hop.

Timing, meals, and pacing:
- Morning sights → midday meal (best_time "midday", category foodie, ~45-90 min duration) → afternoon → optional coffee/snack before a long leg → evening if needed.
- Include a proper food stop around lunch (11:30-2) when the day has 4+ hours of activities.
- "duration_minutes" realistic (museums 60-120, parks 45-90, coffee 20-35, sit-down meal 60-90).
- "best_time" should match when a visitor would normally do that activity; food stops at midday/evening.
- "travel_minutes_to_next" should reflect distance + buffer after meals.`;

const JSONL_DIRECTIVE = `\nOUTPUT FORMAT (critical):
Emit JSON Lines — one JSON object per line, in this strict order:
1. First line MUST be the city header, all on a single line: {"city":"<full city name>","city_center":{"lat":<num>,"lng":<num>}}
2. Then ONE line per day, in order (day 1 first, day N last), each compactly serialised on a single line: {"day":1,"theme":"short day theme","stops":[...]}

Strict rules:
- COMPACT JSON only — no pretty-printing, no extra whitespace, no newlines INSIDE an object.
- Exactly ONE \\n between objects, none inside them.
- No wrapping object (no top-level "trip" or "days"), no markdown fences, no commentary, no trailing prose.
- Every line must be a complete, parseable JSON object.`;

function budgetTierFromAmount(amt: number): "budget" | "mid" | "splurge" {
  if (!Number.isFinite(amt) || amt <= 0) return "mid";
  if (amt < 120) return "budget";
  if (amt < 260) return "mid";
  return "splurge";
}

export type PlanTripResult = {
  plan: TripPlan;
  weather: TripWeather | null;
  provider: "anthropic" | "openai";
  warnings: string[];
};

export type PlanTripError = {
  status: number;
  error: string;
  details?: unknown;
};

function isPlanTripError(e: unknown): e is PlanTripError {
  return typeof e === "object" && e !== null && "status" in e && "error" in e;
}

export function throwPlanError(status: number, error: string, details?: unknown): never {
  const e: PlanTripError = { status, error, details };
  throw e;
}

export { isPlanTripError };

/**
 * NDJSON event types streamed by planTripStream. The shapes mirror what the
 * client merges into its TripPlan state.
 */
export type PlanStreamEvent =
  | { type: "started"; city: string; provider: "anthropic" | "openai" }
  | { type: "city"; city: string; city_center?: { lat: number; lng: number } }
  | { type: "day"; day: TripDay }
  | { type: "stops_located"; day: number; stops: TripStop[] }
  | { type: "stops_enriched"; day: number; stops: TripStop[] }
  | { type: "weather"; weather: TripWeather | null }
  | { type: "complete"; plan: TripPlan; warnings: string[] }
  | { type: "error"; status: number; error: string; details?: unknown };

export type PlanStreamWriter = (event: PlanStreamEvent) => void | Promise<void>;

function buildUserPrompt(input: TripFormInput): string {
  const budgetTier = budgetTierFromAmount(input.budgetAmount);
  const accessibilityLines = [
    input.accessibility.wheelchair ? "- Prioritize wheelchair-accessible venues and routes; avoid stairs-only viewpoints." : null,
    input.accessibility.lowWalking
      ? "- Keep walking distances low: cluster stops tightly; prefer short transfers; reduce stop count if needed."
      : null,
    input.accessibility.restStops ? "- Include frequent rest stops (cafes/parks/benches) and easy bathroom access." : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `Plan a ${input.days}-day trip in ${input.city}.
Group size: ${input.groupSize}. Budget: about $${Math.round(input.budgetAmount)}/day (${budgetTier}). Pace: ${input.pace}. Transport between stops: ${input.transport}.
Interests: ${input.vibes.join(", ")}.
${input.tripDate ? `Trip date (start): ${input.tripDate} (use it for weather-aware choices).\n` : ""}${accessibilityLines ? `Accessibility preferences:\n${accessibilityLines}\n` : ""}
${input.mustInclude ? `Must include or work in: ${input.mustInclude}\n` : ""}${
    input.mustExclude
      ? `Do NOT include these places or obvious substitutes at the same venue (user removed or rejected them): ${input.mustExclude}\n`
      : ""
  }Closeness + meals + narrative:
- Each day: one continuous geographic thread (neighborhood A → nearby B → nearby C). Never order stops so the route obviously doubles back across town unless the trip explicitly needs two hubs—if so, group all A stops then move once to B.
- Place lunch (or main midday food) after morning activities and before distant afternoon stops; snacks/coffee near long walks.
- Match "best_time" + "duration_minutes" + "travel_minutes_to_next" so a human could execute the day without eating dinner at 3pm or sprinting 40 minutes between every stop.
- If a chain has multiple locations, pick the branch closest to your day's cluster.`;
}

function pickProvider(): { provider: "anthropic" | "openai"; key: string } {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (anthropicKey) return { provider: "anthropic", key: anthropicKey };
  if (openaiKey) return { provider: "openai", key: openaiKey };
  throwPlanError(501, "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to generate trips.");
}

/**
 * Yields each complete top-level JSON object from a stream of string deltas.
 * Tracks brace depth with string + escape awareness so whitespace inside string
 * values doesn't split an object prematurely. Handles compact JSON-Lines and
 * pretty-printed multi-object output. A cursor persists across chunks so we
 * never re-scan content we've already accounted for.
 */
async function* splitJsonObjects(stream: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = "";
  let cursor = 0;
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for await (const chunk of stream) {
    buffer += chunk;
    while (cursor < buffer.length) {
      const c = buffer[cursor]!;
      if (escape) {
        escape = false;
      } else if (inString) {
        if (c === "\\") escape = true;
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
      } else if (c === "{") {
        if (depth === 0) start = cursor;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          const piece = buffer.slice(start, cursor + 1);
          buffer = buffer.slice(cursor + 1);
          cursor = 0;
          start = -1;
          if (piece.trim().length > 0) yield piece;
          continue; // skip the cursor++ below — we already reset
        }
      }
      cursor++;
    }
  }
  // Any unterminated trailing content is dropped — better than shipping a half-object.
}

/**
 * Streams text deltas from the chosen LLM provider with the JSONL output
 * directive prepended to the system prompt.
 */
async function* streamLlmText(
  provider: "anthropic" | "openai",
  key: string,
  userPrompt: string,
): AsyncIterable<string> {
  const system = SYSTEM_RULES + JSONL_DIRECTIVE;
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: key });
    const stream = client.messages.stream({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  } else {
    const client = new OpenAI({ apiKey: key });
    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.4",
      temperature: 0.4,
      max_completion_tokens: 8192,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });
    for await (const chunk of stream) {
      const t = chunk.choices[0]?.delta?.content;
      if (t) yield t;
    }
  }
}

function tryParseLine(line: string): Record<string, unknown> | null {
  const cleaned = line
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!cleaned.startsWith("{")) return null;
  try {
    const j = JSON.parse(cleaned);
    return typeof j === "object" && j !== null ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function looksLikeDay(j: Record<string, unknown>): boolean {
  return (
    typeof j.day === "number" &&
    typeof j.theme === "string" &&
    Array.isArray((j as { stops?: unknown }).stops)
  );
}

function looksLikeCity(j: Record<string, unknown>): boolean {
  return typeof j.city === "string" && !("day" in j) && !("days" in j);
}

/**
 * Validate and coerce a single day fragment via the schema. We wrap it in
 * a TripPlan-shaped envelope so normalizeTripJsonPayload + Zod do their work,
 * then pull the parsed day back out.
 */
function validateDayFragment(raw: Record<string, unknown>, city: string): TripDay | null {
  const envelope = normalizeTripJsonPayload({ trip: { city, days: [raw] } }, city) as
    | { trip?: { city_center?: unknown } & Record<string, unknown> }
    | null;
  // normalizeTripJsonPayload writes city_center:null when there are no coords;
  // the Zod schema wants the key absent. Strip it for fragment validation.
  if (envelope?.trip && envelope.trip.city_center == null) {
    delete envelope.trip.city_center;
  }
  const parsed = TripPlanSchema.safeParse(envelope);
  if (!parsed.success) return null;
  return parsed.data.trip.days[0] ?? null;
}

/**
 * Streaming itinerary build. Emits events through `write` as work completes.
 * Caller is responsible for serializing events to NDJSON over the wire.
 */
export async function planTripStream(input: TripFormInput, write: PlanStreamWriter): Promise<void> {
  const warnings: string[] = [];
  const userPrompt = buildUserPrompt(input);

  let provider: "anthropic" | "openai";
  let key: string;
  try {
    const picked = pickProvider();
    provider = picked.provider;
    key = picked.key;
  } catch (e) {
    if (isPlanTripError(e)) {
      await write({ type: "error", status: e.status, error: e.error, details: e.details });
      return;
    }
    throw e;
  }

  await write({ type: "started", city: input.city, provider });

  const mapboxToken =
    (process.env.MAPBOX_ACCESS_TOKEN?.trim() ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()) || null;
  const googleKey = getGoogleGeoKeyFromEnv();

  // Pre-fly city context resolution in parallel with the LLM call so we don't
  // wait for the model to finish before we can start geocoding.
  const cityContextPromise: Promise<ResolvedCityContext | null> = (mapboxToken || googleKey)
    ? resolveCityContext(input.city, mapboxToken, googleKey, input.cityCenter ?? null, null).catch(() => null)
    : Promise.resolve(null);

  // Track everything so we can assemble a canonical final TripPlan.
  const collectedDays = new Map<number, TripDay>();
  const finalStopsByDay = new Map<number, TripStop[]>(); // post-enrich
  let cityCenterFromModel: { lat: number; lng: number } | undefined;
  const followups: Promise<void>[] = [];
  let parseFailures = 0;

  /** Fire-and-track per-day geocode + enrich, emitting events as each completes. */
  function schedulePerDayPipeline(day: TripDay) {
    const work = (async () => {
      const cityCtx = await cityContextPromise;
      if (!cityCtx) {
        finalStopsByDay.set(day.day, day.stops);
        return;
      }
      let located: TripStop[];
      try {
        located = await geocodeStops(day.stops, input.city, cityCtx, mapboxToken, googleKey);
      } catch {
        warnings.push(`geocode_day_${day.day}_failed`);
        finalStopsByDay.set(day.day, day.stops);
        return;
      }
      await write({ type: "stops_located", day: day.day, stops: located });

      let enriched: TripStop[];
      try {
        enriched = await enrichStops(located);
      } catch {
        warnings.push(`enrich_day_${day.day}_failed`);
        enriched = located;
      }
      finalStopsByDay.set(day.day, enriched);
      await write({ type: "stops_enriched", day: day.day, stops: enriched });
    })();
    followups.push(work);
  }

  // Buffer raw output too — used as a fallback if the model pretty-printed
  // and our line-by-line parser couldn't extract any days.
  let rawBuffer = "";

  // Stream the LLM output, parse line-by-line, dispatch per-day work.
  try {
    const llmStream = streamLlmText(provider, key, userPrompt);
    const tee = (async function* () {
      for await (const chunk of llmStream) {
        rawBuffer += chunk;
        yield chunk;
      }
    })();
    for await (const line of splitJsonObjects(tee)) {
      const j = tryParseLine(line);
      if (!j) {
        parseFailures += 1;
        continue;
      }
      if (looksLikeCity(j)) {
        const cc = j.city_center as { lat?: number; lng?: number } | undefined;
        if (cc && Number.isFinite(cc.lat) && Number.isFinite(cc.lng)) {
          cityCenterFromModel = { lat: cc.lat as number, lng: cc.lng as number };
        }
        await write({
          type: "city",
          city: String(j.city ?? input.city),
          city_center: cityCenterFromModel,
        });
        continue;
      }
      if (looksLikeDay(j)) {
        const day = validateDayFragment(j, input.city);
        if (!day) {
          parseFailures += 1;
          warnings.push(`day_${j.day}_invalid`);
          continue;
        }
        collectedDays.set(day.day, day);
        await write({ type: "day", day });
        schedulePerDayPipeline(day);
      }
    }
  } catch (e) {
    await write({
      type: "error",
      status: 502,
      error: e instanceof Error ? e.message : "LLM stream failed",
    });
    return;
  }

  // Fallback: if no days came through line-by-line, try parsing the whole
  // buffered output as one JSON envelope and recover days from it. This
  // handles models that pretty-print or wrap everything in {"trip":{...}}.
  if (collectedDays.size === 0 && rawBuffer.trim().length > 0) {
    warnings.push("jsonl_stream_fallback_to_envelope");
    const cleaned = rawBuffer
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    try {
      const json = JSON.parse(cleaned);
      const normalized = normalizeTripJsonPayload(json, input.city);
      const parsed = TripPlanSchema.safeParse(normalized);
      if (parsed.success) {
        const wholePlan = parsed.data;
        if (
          wholePlan.trip.city_center &&
          Number.isFinite(wholePlan.trip.city_center.lat) &&
          Number.isFinite(wholePlan.trip.city_center.lng)
        ) {
          cityCenterFromModel = wholePlan.trip.city_center;
        }
        await write({
          type: "city",
          city: wholePlan.trip.city,
          city_center: cityCenterFromModel,
        });
        for (const day of wholePlan.trip.days) {
          collectedDays.set(day.day, day);
          await write({ type: "day", day });
          schedulePerDayPipeline(day);
        }
      }
    } catch {
      // fall through to the empty-response error below
    }
  }

  if (collectedDays.size === 0) {
    await write({
      type: "error",
      status: 502,
      error:
        parseFailures > 0
          ? "Model returned no parseable day lines"
          : "Empty model response",
    });
    return;
  }

  // Wait for all per-day geocode + enrich to finish before final assembly.
  await Promise.allSettled(followups);

  // Assemble canonical plan from the collected days + enriched stops.
  const orderedDays = [...collectedDays.values()].sort((a, b) => a.day - b.day).map((d) => ({
    ...d,
    stops: finalStopsByDay.get(d.day) ?? d.stops,
  }));
  const cityCtx = await cityContextPromise;
  const finalCityCenter =
    cityCtx?.setCenter ??
    (cityCenterFromModel ?? input.cityCenter ?? undefined);

  let plan: TripPlan = {
    trip: {
      city: input.city,
      city_center: finalCityCenter,
      days: orderedDays,
    },
  };

  // Re-validate the assembled plan with full schema.
  const finalParse = TripPlanSchema.safeParse(plan);
  if (!finalParse.success) {
    await write({
      type: "error",
      status: 502,
      error: "Final plan failed validation",
      details: finalParse.error.flatten(),
    });
    return;
  }
  plan = finalParse.data;

  try {
    plan = optimizeTripPlanForCloseness(plan);
  } catch {
    warnings.push("optimize_failed");
  }

  // Weather fetch (we already have lat/lng now)
  let weather: TripWeather | null = null;
  const cc = plan.trip.city_center;
  if (cc && Number.isFinite(cc.lat) && Number.isFinite(cc.lng)) {
    try {
      weather = await fetchTripWeather(cc.lat, cc.lng, input.tripDate || null);
    } catch {
      warnings.push("weather_fetch_failed");
    }
  }
  await write({ type: "weather", weather });

  await write({ type: "complete", plan, warnings });
}

/**
 * Buffered one-shot wrapper around planTripStream — preserves the original
 * planTrip contract for non-streaming consumers (group room build).
 */
export async function planTrip(input: TripFormInput): Promise<PlanTripResult> {
  let plan: TripPlan | null = null;
  let weather: TripWeather | null = null;
  let provider: "anthropic" | "openai" = "openai";
  let warnings: string[] = [];
  let errorEvent: Extract<PlanStreamEvent, { type: "error" }> | null = null;

  await planTripStream(input, (ev) => {
    switch (ev.type) {
      case "started":
        provider = ev.provider;
        break;
      case "weather":
        weather = ev.weather;
        break;
      case "complete":
        plan = ev.plan;
        warnings = ev.warnings;
        break;
      case "error":
        errorEvent = ev;
        break;
      default:
        break;
    }
  });

  if (errorEvent) {
    // narrow it explicitly for the type checker
    const err = errorEvent as Extract<PlanStreamEvent, { type: "error" }>;
    throwPlanError(err.status, err.error, err.details);
  }
  if (!plan) {
    throwPlanError(502, "planTripStream returned without a final plan");
  }
  // For backwards compat, also run the legacy one-shot enrichment in case the
  // streaming path missed something; this is cheap given everything is cached.
  let final = plan as TripPlan;
  try {
    final = await enrichTripPlan(final);
  } catch {
    warnings.push("enrich_followup_failed");
  }
  // refineTripPlanWithMapbox already ran per-day in the stream; no need to repeat.
  return { plan: final, weather, provider, warnings };
}

// Re-export so callers that imported these previously keep working.
export { refineTripPlanWithMapbox };

export function tripFormFromPartial(b: {
  city: string;
  cityCenter?: { lat: number; lng: number } | null;
  days?: number;
  groupSize?: number;
  budgetAmount?: number;
  pace?: TripFormInput["pace"];
  vibes?: string[];
  mustInclude?: string;
  mustExclude?: string;
  transport?: TripFormInput["transport"];
  tripDate?: string | null;
  accessibility?: Partial<TripFormInput["accessibility"]>;
}): TripFormInput {
  const budgetAmount = b.budgetAmount ?? defaultTripForm.budgetAmount;
  const accessibility = {
    wheelchair: Boolean(b.accessibility?.wheelchair ?? defaultTripForm.accessibility.wheelchair),
    lowWalking: Boolean(b.accessibility?.lowWalking ?? defaultTripForm.accessibility.lowWalking),
    restStops: Boolean(b.accessibility?.restStops ?? defaultTripForm.accessibility.restStops),
  };
  return {
    city: b.city,
    cityCenter: b.cityCenter ?? null,
    cityLocationReady: true,
    days: b.days ?? defaultTripForm.days,
    groupSize: b.groupSize ?? defaultTripForm.groupSize,
    budgetAmount,
    pace: b.pace ?? defaultTripForm.pace,
    vibes: (b.vibes as TripFormInput["vibes"])?.length
      ? (b.vibes as TripFormInput["vibes"])
      : defaultTripForm.vibes,
    mustInclude: b.mustInclude?.trim() ?? "",
    mustExclude: b.mustExclude?.trim() ?? "",
    transport: b.transport ?? defaultTripForm.transport,
    tripDate: (b.tripDate ?? defaultTripForm.tripDate) || "",
    accessibility,
  };
}
