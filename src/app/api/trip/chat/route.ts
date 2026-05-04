import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { defaultTripForm, type TripFormInput } from "@/lib/trip-schema";
import { z } from "zod";

export const maxDuration = 60;

const BodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(8000),
    }),
  ),
  /** True when an itinerary is already on screen — user is refining; signal readyToPlan to refresh the plan. */
  hasExistingPlan: z.boolean().optional(),
  draft: z
    .object({
      city: z.string().optional(),
      cityCenter: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
      cityLocationReady: z.boolean().optional(),
      days: z.number().optional(),
      groupSize: z.number().optional(),
      budgetAmount: z.number().optional(),
      pace: z.string().optional(),
      vibes: z.array(z.string()).optional(),
      mustInclude: z.string().optional(),
      transport: z.string().optional(),
      tripDate: z.string().optional(),
      accessibility: z
        .object({
          wheelchair: z.boolean().optional(),
          lowWalking: z.boolean().optional(),
          restStops: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

const ReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  readyToPlan: z.boolean(),
  patch: z
    .object({
      city: z.string().optional(),
      days: z.number().optional(),
      groupSize: z.number().optional(),
      budgetAmount: z.number().optional(),
      pace: z.enum(["packed", "balanced", "relaxed"]).optional(),
      vibes: z.array(z.string()).optional(),
      mustInclude: z.string().optional(),
      transport: z.enum(["walking", "driving"]).optional(),
      tripDate: z.string().optional(),
      accessibility: z
        .object({
          wheelchair: z.boolean().optional(),
          lowWalking: z.boolean().optional(),
          restStops: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

const CHAT_SYSTEM = `You are Wander, a friendly trip-planning assistant. You help users describe a trip in natural language.

You MUST respond with a single JSON object only (no markdown, no code fences), shape:
{
  "reply": string,
  "readyToPlan": boolean,
  "patch": object | omitted
}

"patch" (when you infer values) may include: city (string), days (1-14), groupSize (1-50), budgetAmount (0-100000 per day USD), pace packed|balanced|relaxed,
vibes from: foodie, history, nightlife, outdoors, art, hidden_gems, family, photography,
mustInclude (string), transport walking|driving, tripDate YYYY-MM-DD, accessibility { wheelchair, lowWalking, restStops }.

CRITICAL — latest user message wins (corrections):
- You will receive a duplicated "HIGHEST PRIORITY" block with the user's **last** message. That message OVERRIDES the saved draft and earlier assistant turns for purposes of "patch" and your summary in "reply".
- Single-word or short replies are usually corrections: "driving" / "by car" / "car" → patch.transport "driving". "walking" / "on foot" → "walking".
- Money: "$50", "$50 a day", "50 bucks", "just 50" → patch.budgetAmount 50 (per day, integer).
- If the user just corrected something, your "reply" MUST reflect the new value — never repeat walking/budget/days/vibes from before their correction.
- If the last message is "nope" / "no" / "that's all" / "nothing else", treat it as answering your last question; do not re-ask the same question — advance the conversation or set readyToPlan if everything is collected.

CRITICAL — chat before "ready":
- Have a real conversation: destination, how many days, pace, daily budget, vibes/interests, walking vs driving, group size, optional dates — usually **2+ back-and-forth turns** after the first user message unless their first message already contains all of that.
- Each turn: ask **at most one** new follow-up OR summarize what you understood and ask what they'd like to tweak.
- Merge facts into "patch" as you learn them even when readyToPlan is false (partial patch is OK).

When "readyToPlan" should be **true** (handoff — user still taps "Build" in the app, but you signal you're done collecting):
- You have city + days + budgetAmount + pace + vibes + transport from the thread (or patch), AND
- Either the user said they're done / "that's all" / "go ahead" / "build it" / "show me the itinerary", OR you asked a final "Anything else before I wrap this up?" style question and they answered (including "no"/"that's it").

When "readyToPlan" must be **false**:
- Any important field still unknown or vague — ask one short question in "reply".
- Do **not** set readyToPlan true on the first reply right after a short user message unless that message already contained a full spec.

Promises in "reply":
- Do NOT say you are generating/building the map/itinerary in prose; the app builds when the user taps Build. You may say you're ready to hand off when readyToPlan is true.
- Use plain sentences only in "reply" — no markdown, no **asterisks**, no bullet lists longer than 3 short items.

Never invent JSON keys outside patch / reply / readyToPlan.`;

function draftSummary(d: TripFormInput | undefined): string {
  if (!d) return JSON.stringify(defaultTripForm, null, 0);
  return JSON.stringify(
    {
      city: d.city,
      days: d.days,
      groupSize: d.groupSize,
      budgetAmount: d.budgetAmount,
      pace: d.pace,
      vibes: d.vibes,
      mustInclude: d.mustInclude || undefined,
      transport: d.transport,
      tripDate: d.tripDate || undefined,
      accessibility: d.accessibility,
      cityLocationReady: d.cityLocationReady,
    },
    null,
    0,
  );
}

function parseModelJson(raw: string): z.infer<typeof ReplySchema> | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  let j: unknown;
  try {
    j = JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }
  const p = ReplySchema.safeParse(j);
  return p.success ? p.data : null;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { messages, draft, hasExistingPlan } = parsed.data;
  if (!messages.length) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const existingPlanNote = hasExistingPlan
    ? "\n\nCONTEXT: An itinerary is ALREADY shown on the map. The user is refining it in chat. When their requests warrant a new plan (new days, city, pace, budget, major vibe change, or they say to refresh/rebuild), set readyToPlan true with a full patch — the client will regenerate the map automatically. For tiny wording-only tweaks, readyToPlan may stay false."
    : "\n\nThe client can auto-regenerate the map when you set readyToPlan true (after city is confirmed). The user can also tap Build / Update next to Send. If cityLocationReady is false, still set patch.city from the conversation.";

  const draftBlock = `Current saved trip preferences (merge patches into this):\n${draftSummary(draft as TripFormInput | undefined)}${existingPlanNote}`;

  const userBlock = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const priorityBlock =
    lastUser?.content?.trim().length ?
      `\n\n---\nHIGHEST PRIORITY — Latest USER message (must update "patch" and your "reply" summary to match this, even if the saved draft or older turns disagreed):\n"""${lastUser.content}"""\n`
    : "";

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let rawText: string;
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      system: CHAT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${draftBlock}\n\n---\nConversation:\n${userBlock}${priorityBlock}\nRespond with JSON only.`,
        },
      ],
    });
    const block = msg.content[0];
    if (block.type !== "text") {
      return NextResponse.json({ error: "Unexpected response" }, { status: 502 });
    }
    rawText = block.text;
  } else if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CHAT_SYSTEM },
        { role: "user", content: `${draftBlock}\n\n---\nConversation:\n${userBlock}${priorityBlock}\nRespond with JSON only.` },
      ],
    });
    const t = completion.choices[0]?.message?.content;
    if (!t) {
      return NextResponse.json({ error: "Empty model response" }, { status: 502 });
    }
    rawText = t;
  } else {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY or OPENAI_API_KEY for chat.", reply: "", readyToPlan: false },
      { status: 501 },
    );
  }

  const out = parseModelJson(rawText);
  if (!out) {
    return NextResponse.json(
      {
        error: "Model returned invalid JSON",
        reply: "I had trouble formatting that. Could you repeat your trip in one short message?",
        readyToPlan: false,
      },
      { status: 502 },
    );
  }

  const modelSaidReady = out.readyToPlan;
  let readyToPlan = modelSaidReady;
  const d = draft as TripFormInput | undefined;
  if (d && !d.cityLocationReady) {
    readyToPlan = false;
  }
  const patchCity = out.patch?.city?.trim();
  if (patchCity && patchCity !== (d?.city ?? "").trim()) {
    // City changed in patch — client will re-run geocode; do not auto-plan this turn
    readyToPlan = false;
  }

  /** Model wanted a plan but server requires waiting (city confirm or geocode after patch). Client runs /plan when city becomes ready. */
  const planWhenCityReady = modelSaidReady && !readyToPlan;

  return NextResponse.json({
    reply: out.reply,
    readyToPlan,
    planWhenCityReady,
    patch: out.patch ?? undefined,
  });
}
