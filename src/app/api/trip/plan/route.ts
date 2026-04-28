import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  TripPlanSchema,
  type TripFormInput,
  defaultTripForm,
  normalizeTripJsonPayload,
} from "@/lib/trip-schema";
import { getGoogleGeoKeyFromEnv, refineTripPlanWithMapbox } from "@/lib/trip-geocode";
import { enrichTripPlan } from "@/lib/trip-enrich";
import { fetchTripWeather } from "@/lib/weather";
import { z } from "zod";

export const maxDuration = 120;

const RequestBodySchema = z.object({
  city: z.string().min(1).max(200),
  days: z.number().int().min(1).max(14).optional(),
  groupSize: z.number().int().min(1).max(50).optional(),
  budgetAmount: z.number().min(0).max(100000).optional(),
  pace: z.enum(["packed", "balanced", "relaxed"]).optional(),
  vibes: z.array(z.string()).optional(),
  mustInclude: z.string().max(2000).optional(),
  transport: z.enum(["walking", "driving"]).optional(),
  cityCenter: z.object({ lat: z.number(), lng: z.number() }).nullish(),
  tripDate: z.string().nullish(),
  accessibility: z
    .object({
      wheelchair: z.boolean().optional(),
      lowWalking: z.boolean().optional(),
      restStops: z.boolean().optional(),
    })
    .optional(),
});

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
- Use real, verifiable places. Prefer a walkable order for walking transport.
- 3-8 stops per day depending on pace: packed=more, relaxed=fewer.
- Each stop must have unique "id" strings.
- Descriptions must be specific and useful, not generic.
- "travel_minutes_to_next" is your estimate; it may be refined with routing later.
- If the city is ambiguous, pick the well-known one (e.g. "SF" = San Francisco, USA).`;

function budgetTierFromAmount(amt: number): "budget" | "mid" | "splurge" {
  if (!Number.isFinite(amt) || amt <= 0) return "mid";
  if (amt < 120) return "budget";
  if (amt < 260) return "mid";
  return "splurge";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;
  const budgetAmount = b.budgetAmount ?? defaultTripForm.budgetAmount;
  const accessibility = {
    wheelchair: Boolean(b.accessibility?.wheelchair ?? defaultTripForm.accessibility.wheelchair),
    lowWalking: Boolean(b.accessibility?.lowWalking ?? defaultTripForm.accessibility.lowWalking),
    restStops: Boolean(b.accessibility?.restStops ?? defaultTripForm.accessibility.restStops),
  };
  const input: TripFormInput = {
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
    transport: b.transport ?? defaultTripForm.transport,
    tripDate: (b.tripDate ?? defaultTripForm.tripDate) || "",
    accessibility,
  };

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
${input.mustInclude ? `Must include or work in: ${input.mustInclude}\n` : ""}
Return the JSON object only.`;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let rawText: string;
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content[0];
    if (block.type !== "text") {
      return NextResponse.json({ error: "Unexpected response from Claude" }, { status: 502 });
    }
    rawText = block.text;
  } else if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM + "\nOutput a single JSON object with key trip." },
        { role: "user", content: userPrompt },
      ],
    });
    const t = completion.choices[0]?.message?.content;
    if (!t) {
      return NextResponse.json({ error: "Empty model response" }, { status: 502 });
    }
    rawText = t;
  } else {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to generate trips." },
      { status: 501 },
    );
  }

  let json: unknown;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    json = JSON.parse(cleaned) as unknown;
  } catch {
    return NextResponse.json({ error: "Model returned non-JSON", raw: rawText.slice(0, 2000) }, { status: 502 });
  }

  const normalized = normalizeTripJsonPayload(json, input.city);
  const out = TripPlanSchema.safeParse(normalized);
  if (!out.success) {
    return NextResponse.json(
      {
        error: "Trip JSON failed validation",
        details: out.error.flatten(),
        hint: "The model may have used a different key shape; we try lat/lng aliases, activity lists, and itinerary-style output. If this persists, try a simpler city or fewer days.",
        rawPreview: json,
        normalizedPreview: normalized,
      },
      { status: 502 },
    );
  }

  let plan = out.data;
  const mapboxToken =
    (process.env.MAPBOX_ACCESS_TOKEN?.trim() ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()) || null;
  const googleKey = getGoogleGeoKeyFromEnv();
  if (mapboxToken || googleKey) {
    try {
      const confirmed =
        b.cityCenter != null && Number.isFinite(b.cityCenter.lat) && Number.isFinite(b.cityCenter.lng)
          ? { lat: b.cityCenter.lat, lng: b.cityCenter.lng }
          : null;
      plan = await refineTripPlanWithMapbox(plan, input.city, mapboxToken, googleKey, confirmed);
    } catch {
      // Keep model output if geocoding fails (rate limit, network, etc.)
    }
  }

  // Enrich with cuisine/opening_hours/etc when possible (best-effort).
  try {
    plan = await enrichTripPlan(plan);
  } catch {
    // ignore
  }

  const cc = plan.trip.city_center;
  const weather = await fetchTripWeather(cc?.lat, cc?.lng, input.tripDate || null);

  return NextResponse.json({
    plan,
    provider: anthropicKey ? "anthropic" : "openai",
    weather,
  });
}
