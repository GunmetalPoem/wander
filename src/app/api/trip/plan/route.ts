import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  TripPlanSchema,
  type TripFormInput,
  defaultTripForm,
  normalizeTripJsonPayload,
} from "@/lib/trip-schema";
import { z } from "zod";

export const maxDuration = 120;

const RequestBodySchema = z.object({
  city: z.string().min(1).max(120),
  days: z.number().int().min(1).max(14).optional(),
  groupSize: z.number().int().min(1).max(50).optional(),
  budget: z.enum(["budget", "mid", "splurge"]).optional(),
  pace: z.enum(["packed", "balanced", "relaxed"]).optional(),
  vibes: z.array(z.string()).optional(),
  mustInclude: z.string().max(2000).optional(),
  transport: z.enum(["walking", "driving"]).optional(),
});

const SYSTEM = `You are a travel planner API. You output ONLY valid JSON (no markdown fences) matching this structure:
{
  "trip": {
    "city": string,
    "city_center": { "lat": number, "lng": number }  // rough center of the city for map framing,
    "days": [
      {
        "day": 1,
        "theme": "short day theme",
        "stops": [
          {
            "id": "unique_id",
            "name": "Place name",
            "address": "Full street address for geocoding",
            "lat": 0,
            "lng": 0,
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
- Use real places with accurate lat/lng (WGS84) for the requested city. Prefer walkable order for walking transport.
- 3-8 stops per day depending on pace: packed=more, relaxed=fewer.
- Each stop must have unique "id" strings.
- Descriptions must be specific and useful, not generic.
- "travel_minutes_to_next" is your estimate; it will be refined with routing later.
- If the city is ambiguous, pick the well-known one (e.g. "SF" = San Francisco, USA).`;

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
  const input: TripFormInput = {
    city: b.city,
    days: b.days ?? defaultTripForm.days,
    groupSize: b.groupSize ?? defaultTripForm.groupSize,
    budget: b.budget ?? defaultTripForm.budget,
    pace: b.pace ?? defaultTripForm.pace,
    vibes: (b.vibes as TripFormInput["vibes"])?.length
      ? (b.vibes as TripFormInput["vibes"])
      : defaultTripForm.vibes,
    mustInclude: b.mustInclude?.trim() ?? "",
    transport: b.transport ?? defaultTripForm.transport,
  };

  const userPrompt = `Plan a ${input.days}-day trip in ${input.city}.
Group size: ${input.groupSize}. Budget: ${input.budget}. Pace: ${input.pace}. Transport between stops: ${input.transport}.
Interests: ${input.vibes.join(", ")}.
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

  return NextResponse.json({ plan: out.data, provider: anthropicKey ? "anthropic" : "openai" });
}
