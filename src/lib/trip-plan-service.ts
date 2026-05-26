import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  TripPlanSchema,
  type TripFormInput,
  type TripPlan,
  defaultTripForm,
  normalizeTripJsonPayload,
} from "@/lib/trip-schema";
import { getGoogleGeoKeyFromEnv, refineTripPlanWithMapbox } from "@/lib/trip-geocode";
import { enrichTripPlan } from "@/lib/trip-enrich";
import { fetchTripWeather, type TripWeather } from "@/lib/weather";
import { optimizeTripPlanForCloseness } from "@/lib/trip-optimize";

const SYSTEM = `You are a travel planner API. You output ONLY valid JSON (no markdown fences) matching this structure:
{
  "trip": {
    "city": string,
    "city_center": { "lat": number, "lng": number }  // rough map center of the city (WGS84); used for map framing and search bias,
    "days": [
      {
        "day": 1,
        "theme": "short day theme",
        "stops": [
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
            "travel_minutes_to_next": 10  // or null for last stop
          }
        ]
      }
    ]
  }
}

Rules:
- Return null for "lat" and "lng" on every stop. Only return name, address, city (via "city"), and descriptions. Do not guess or invent coordinates.
- "city_center" is the only place you give approximate map coordinates: use a real central point in the destination city (WGS84).
- Use real, verifiable places.
- 3-8 stops per day depending on pace: packed=more, relaxed=fewer.
- Each stop must have unique "id" strings.
- Descriptions must be specific and useful, not generic.
- "travel_minutes_to_next" is your estimate; it may be refined with routing later.
- If the city is ambiguous, pick the well-known one (e.g. "SF" = San Francisco, USA).
- If the user prompt lists places to never include, do not add those venues (or obvious same-venue substitutes) to any day.

Geography & route shape (critical):
- List stops in an order you could actually walk or drive without crossing the city repeatedly: each next stop should be near the previous cluster (same neighborhood or adjacent), not "east → west → east again".
- For walking transport especially: stay within 1–3 contiguous areas per day unless a rare must-see justifies a longer hop.

Timing, meals, and pacing:
- Think in clock time: morning sights → midday meal (use "best_time": "midday" and category foodie for sit-down lunch, ~45–90 min "duration_minutes") → afternoon → optional coffee/snack before a long leg → evening if needed.
- Put at least one proper food stop around lunch (11:30–2) when the day is 4+ hours of activities; do not stack three museums and then only dinner unless pace is packed and you add a quick snack stop with short duration.
- "duration_minutes" must be realistic for the activity (museums 60–120, parks 45–90, coffee 20–35, sit-down meal 60–90).
- "best_time" on each stop should match when a visitor would normally do that activity; align food stops to midday or evening as appropriate.
- Leave plausible gaps: "travel_minutes_to_next" should reflect distance + buffer after meals (people do not teleport after lunch).`;

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

export async function planTrip(input: TripFormInput): Promise<PlanTripResult> {
  const warnings: string[] = [];
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

  const userPrompt = `Plan a ${input.days}-day trip in ${input.city}.
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
- If a chain has multiple locations, pick the branch closest to your day's cluster.
Return the JSON object only.`;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let rawText: string;
  let provider: "anthropic" | "openai";
  if (anthropicKey) {
    provider = "anthropic";
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content[0];
    if (block.type !== "text") {
      throwPlanError(502, "Unexpected response from Claude");
    }
    rawText = block.text;
  } else if (openaiKey) {
    provider = "openai";
    const client = new OpenAI({ apiKey: openaiKey });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.4",
      temperature: 0.4,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM + "\nOutput a single JSON object with key trip." },
        { role: "user", content: userPrompt },
      ],
    });
    const t = completion.choices[0]?.message?.content;
    if (!t) {
      throwPlanError(502, "Empty model response");
    }
    rawText = t;
  } else {
    throwPlanError(501, "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to generate trips.");
  }

  let json: unknown;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    json = JSON.parse(cleaned) as unknown;
  } catch {
    throwPlanError(502, "Model returned non-JSON", { raw: rawText.slice(0, 2000) });
  }

  const normalized = normalizeTripJsonPayload(json, input.city);
  const out = TripPlanSchema.safeParse(normalized);
  if (!out.success) {
    throwPlanError(502, "Trip JSON failed validation", {
      details: out.error.flatten(),
      hint:
        "The model may have used a different key shape; we try lat/lng aliases, activity lists, and itinerary-style output. If this persists, try a simpler city or fewer days.",
      rawPreview: json,
      normalizedPreview: normalized,
    });
  }

  let plan = out.data;
  const mapboxToken =
    (process.env.MAPBOX_ACCESS_TOKEN?.trim() ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()) || null;
  const googleKey = getGoogleGeoKeyFromEnv();
  if (mapboxToken || googleKey) {
    try {
      const cc = input.cityCenter;
      const confirmed =
        cc != null && Number.isFinite(cc.lat) && Number.isFinite(cc.lng)
          ? { lat: cc.lat, lng: cc.lng }
          : null;
      plan = await refineTripPlanWithMapbox(plan, input.city, mapboxToken, googleKey, confirmed);
    } catch {
      warnings.push("geocode_refine_failed");
    }
  }

  const cc = plan.trip.city_center;
  const weatherPromise = fetchTripWeather(cc?.lat, cc?.lng, input.tripDate || null).catch(() => {
    warnings.push("weather_fetch_failed");
    return null;
  });

  try {
    plan = await enrichTripPlan(plan);
  } catch {
    warnings.push("enrich_failed");
  }

  try {
    plan = optimizeTripPlanForCloseness(plan);
  } catch {
    warnings.push("optimize_failed");
  }

  const weather = await weatherPromise;

  return { plan, weather, provider, warnings };
}

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
