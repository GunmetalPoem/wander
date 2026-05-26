import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import type { TripChatPatch } from "@/lib/trip-chat-merge";

export type ParticipantPrefs = {
  values: TripChatPatch;
  touched: string[];
};

const PatchSchema = z
  .object({
    city: z.string().optional(),
    days: z.number().optional(),
    groupSize: z.number().optional(),
    budgetAmount: z.number().optional(),
    pace: z.enum(["packed", "balanced", "relaxed"]).optional(),
    vibes: z.array(z.string()).optional(),
    mustInclude: z.string().optional(),
    mustExclude: z.string().optional(),
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
  .optional();

const ReplySchema = z.object({
  reply: z.string().min(1).max(2000),
  patch: PatchSchema,
});

const EXTRACT_SYSTEM = `You are Wander's group-trip assistant. You are talking to ONE traveler in a group chat. Other travelers have their own columns; do NOT make decisions for the group or merge other people's preferences here — only capture what THIS participant says they want.

You MUST respond with a single JSON object only (no markdown, no code fences), shape:
{
  "reply": string,
  "patch": object | omitted
}

"patch" (when you infer values from THIS participant only) may include:
- city (string)
- days (1-14)
- groupSize (1-50)
- budgetAmount (0-100000 per day USD)
- pace: packed|balanced|relaxed
- vibes from: foodie, history, nightlife, outdoors, art, hidden_gems, family, photography
- mustInclude (string)
- mustExclude (string; semicolon-separated venues this person doesn't want)
- transport: walking|driving
- tripDate: YYYY-MM-DD
- accessibility: { wheelchair, lowWalking, restStops }

CRITICAL — single-participant scope:
- Treat "we" / "us" as still THIS participant expressing a preference. Do not invent values for absent teammates.
- Do NOT include fields the participant has not mentioned (across all their turns provided).
- Single-word corrections override their prior values: "driving" → patch.transport "driving"; "$50" → patch.budgetAmount 50.

Reply rules:
- 1 short sentence acknowledging what you captured, addressed to {displayName}. Example: "Got it — 3 days and walking pace noted."
- Plain sentences only. No markdown, no asterisks, no bullets, no follow-up questions about whether to build (the group decides via the Build button in the unified panel).
- Never invent JSON keys outside patch / reply.`;

export type ExtractInput = {
  displayName: string;
  recentMessages: { role: "user" | "assistant"; content: string }[];
  priorPrefs: ParticipantPrefs;
};

export type ExtractResult = {
  reply: string;
  patch: TripChatPatch;
  touched: string[];
};

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

const PATCH_KEYS = [
  "city",
  "days",
  "groupSize",
  "budgetAmount",
  "pace",
  "vibes",
  "mustInclude",
  "mustExclude",
  "transport",
  "tripDate",
  "accessibility",
] as const;

function isPatchKey(k: string): k is (typeof PATCH_KEYS)[number] {
  return (PATCH_KEYS as readonly string[]).includes(k);
}

function patchValueChanged(prior: TripChatPatch, patch: TripChatPatch, key: (typeof PATCH_KEYS)[number]): boolean {
  if (!(key in patch)) return false;
  const a = (prior as Record<string, unknown>)[key];
  const b = (patch as Record<string, unknown>)[key];
  if (a === undefined && b === undefined) return false;
  return JSON.stringify(a) !== JSON.stringify(b);
}

export async function extractParticipantPatch(args: ExtractInput): Promise<ExtractResult> {
  const { displayName, recentMessages, priorPrefs } = args;

  const conversation = recentMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  const lastUser = [...recentMessages].reverse().find((m) => m.role === "user");
  const priorityBlock = lastUser?.content?.trim().length
    ? `\n\n---\nHIGHEST PRIORITY — Latest USER message from ${displayName} (must update "patch" and "reply" to match this):\n"""${lastUser.content}"""\n`
    : "";

  const priorBlock = `${displayName}'s previously captured preferences:\n${JSON.stringify(priorPrefs.values, null, 0)}\n(touched fields: ${priorPrefs.touched.join(", ") || "none"})`;

  const userBlock = `${priorBlock}\n\n---\nConversation so far (only ${displayName}'s messages and your prior acks):\n${conversation}${priorityBlock}\nRespond with JSON only.`;

  const systemPrompt = EXTRACT_SYSTEM.replaceAll("{displayName}", displayName);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  let rawText: string;
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userBlock }],
    });
    const block = msg.content[0];
    if (block.type !== "text") {
      throw new Error("Unexpected response from Claude");
    }
    rawText = block.text;
  } else if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.4",
      temperature: 0.4,
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userBlock },
      ],
    });
    const t = completion.choices[0]?.message?.content;
    if (!t) throw new Error("Empty model response");
    rawText = t;
  } else {
    return {
      reply: `Captured what ${displayName} said (offline mode — set ANTHROPIC_API_KEY for real extraction).`,
      patch: {},
      touched: [],
    };
  }

  const out = parseModelJson(rawText);
  if (!out) {
    return {
      reply: `(${displayName}) I had trouble parsing that — could you repeat it in one short sentence?`,
      patch: {},
      touched: [],
    };
  }

  const patch = (out.patch ?? {}) as TripChatPatch;
  const touched = new Set<string>(priorPrefs.touched);
  for (const k of Object.keys(patch)) {
    if (!isPatchKey(k)) continue;
    if (patchValueChanged(priorPrefs.values, patch, k)) {
      touched.add(k);
    } else if ((patch as Record<string, unknown>)[k] !== undefined) {
      touched.add(k);
    }
  }

  return {
    reply: out.reply,
    patch,
    touched: Array.from(touched),
  };
}
