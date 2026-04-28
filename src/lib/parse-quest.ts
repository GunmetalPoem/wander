import OpenAI from "openai";
import { z, type ZodTypeAny } from "zod";

/** Coerce null/omitted/odd types into a string; models sometimes skip `title` or return numbers. */
function looseString(): ZodTypeAny {
  return z
    .any()
    .transform((v) => {
      if (v == null) return "";
      if (typeof v === "string") return v;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      return "";
    });
}

const CATEGORIES = [
  "tradition",
  "urban_exploration",
  "social",
  "history",
  "challenge",
] as const;

const ALLOWED_WARNINGS = new Set([
  "night_common",
  "physical",
  "restricted_or_unclear_access",
  "height",
  "group_recommended",
  "weather_dependent",
]);

/** Normalized quest shape written to the database. */
export type ParsedQuest = {
  title: string;
  loreBlurb: string;
  description: string;
  steps: string[];
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  difficulty: number;
  safetyScore: number;
  warnings: string[];
  category: (typeof CATEGORIES)[number];
  confidence: number;
};

/** If the model used `name` / `quest_title` instead of `title`, or odd `steps` shapes, normalize. */
const RawQuestSchema = z.preprocess((data) => {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return data;
  const o = { ...(data as Record<string, unknown>) };
  if (o.title == null || o.title === "") {
    if (o.name != null) o.title = o.name;
    else if (o.quest_title != null) o.title = o.quest_title;
  }
  if (o.steps == null) {
    o.steps = undefined;
  } else if (typeof o.steps === "string") {
    o.steps = o.steps ? [o.steps] : [];
  } else if (!Array.isArray(o.steps)) {
    o.steps = [];
  }
  if (o.warnings == null) {
    o.warnings = undefined;
  } else if (!Array.isArray(o.warnings)) {
    o.warnings = [];
  }
  return o;
},
z.object({
  title: looseString(),
  /** 3-8 sentences: ONLY facts/names/quotes supported by numbered SOURCE CHUNKS in the user message. */
  sourcesSay: looseString().optional(),
  loreBlurb: looseString().optional(),
  description: looseString().optional(),
  steps: z
    .array(
      z.preprocess(
        (v) => (v == null ? "" : typeof v === "string" ? v : String(v)),
        z.string(),
      ),
    )
    .optional(),
  locationName: z.union([looseString(), z.null()]).optional(),
  lat: z.union([z.number(), z.null()]).optional(),
  lng: z.union([z.number(), z.null()]).optional(),
  difficulty: z.coerce.number().optional(),
  safetyScore: z.coerce.number().optional(),
  warnings: z.array(looseString()).optional(),
  category: looseString().optional(),
  confidence: z.coerce.number().optional(),
}),
);

const RawExtractSchema = z.object({
  quests: z.array(RawQuestSchema).min(0).max(8),
});

function clampInt(n: number, lo: number, hi: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  const r = Math.round(n);
  if (r < lo) return lo;
  if (r > hi) return hi;
  return r;
}

function clamp01(n: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeCategory(s: string | undefined): ParsedQuest["category"] {
  const t = (s ?? "").trim().toLowerCase().replace(/[- ]/g, "_");
  if ((CATEGORIES as readonly string[]).includes(t)) return t as ParsedQuest["category"];
  return "history";
}

function normalizeWarnings(arr: string[] | undefined): string[] {
  const out: string[] = [];
  for (const w of arr ?? []) {
    const k = w.trim().toLowerCase().replace(/[- ]/g, "_");
    if (ALLOWED_WARNINGS.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

function normalizeQuest(raw: z.infer<typeof RawQuestSchema>): ParsedQuest {
  const title = raw.title.trim() || "Untitled quest";
  const sourcesSay = (raw.sourcesSay ?? "").trim();
  const body =
    (raw.description ?? "").trim() ||
    "No additional narrative was returned; rely on the sources list in the app and the paragraph above.";

  const description = sourcesSay
    ? `What the sources say (must match numbered SOURCE CHUNKS; no new facts below this line):\n${sourcesSay}\n\nQuest framing and how to engage (still no new factual claims):\n${body}`
    : `What the sources say:\nThe model did not return a sourcesSay field. Manually verify every claim against the scrape source URLs. Treat named places/objects as unverified until you find them in the text.\n\nQuest framing:\n${body}`;

  const loreBlurb =
    (raw.loreBlurb ?? "").trim() ||
    description.slice(0, 220).trim() ||
    title.slice(0, 160);

  let steps = (raw.steps ?? []).map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) {
    steps = [
      "Open each source URL from this scrape; search within page for proper nouns (cave names, trails, buildings) before visiting.",
      "If sources lack exact routes, use library or student-newspaper archives with keywords from the rumor (not the rumor alone).",
      "Do not enter restricted spaces; confirm public access and hours with official channels.",
    ];
  }
  if (steps.length > 12) steps = steps.slice(0, 12);

  const lat = raw.lat != null && Number.isFinite(raw.lat) ? raw.lat : null;
  const lng = raw.lng != null && Number.isFinite(raw.lng) ? raw.lng : null;
  const coordsOk =
    lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const loc =
    raw.locationName === undefined || raw.locationName === null
      ? null
      : raw.locationName.trim() || null;

  return {
    title,
    loreBlurb,
    description,
    steps,
    locationName: loc,
    lat: coordsOk ? lat : null,
    lng: coordsOk ? lng : null,
    difficulty: clampInt(raw.difficulty ?? NaN, 1, 5, 2),
    safetyScore: clampInt(raw.safetyScore ?? NaN, 1, 5, 2),
    warnings: normalizeWarnings(raw.warnings),
    category: normalizeCategory(raw.category),
    confidence: clamp01(raw.confidence ?? NaN, 0.55),
  };
}

/** Set in normalizeQuest when sourcesSay was present; missing = model left it empty (unusable for the feed). */
const GROUNDED_DESCRIPTION_ANCHOR =
  "What the sources say (must match numbered SOURCE CHUNKS; no new facts below this line):";

function isPlaceholderQuest(q: ParsedQuest): boolean {
  const t = q.title.trim().toLowerCase();
  if (t === "untitled quest" || t === "untitled") return true;
  if (!q.description.includes(GROUNDED_DESCRIPTION_ANCHOR)) return true;
  return false;
}

const REPAIR_TURN = `The previous answer was rejected: one or more quests were missing a real "sourcesSay" (3+ sentences from the [SOURCE n] blocks) or had "Untitled" or empty text. 
Return a single new JSON object only, same shape {"quests":[...]}. 
Every quest must have: a specific "title" (not "Untitled"), "sourcesSay" with 3+ sentences that quote or paraphrase the SOURCE text with at least one proper noun when one appears, non-empty "loreBlurb", and a real "description" (not "No"). 
If the sources still will not support a grounded quest, return {"quests":[]}.`;

const SYSTEM = `You extract evidence-grounded "quests" for an app called Wander. Wander is for HYPERLOCAL campus/city stuff people do, hear, or look for: named places, hikes, rumors about a real spot, pranks, streaks, "before you graduate" rituals, and oral history about THIS place. It is NOT for generic education policy, national admissions drama, or sociology essays where the school is only a backdrop.

PRIORITY (when several topics appear in the SOURCE blocks, you MUST favor higher-priority rows first, and you may OMIT lower-priority topics entirely):
- HIGHEST: named geography or routes (cave, dish, quarry, trail, fountain, reserve, dish antenna area, "beyond the fence", specific building nicknames, tunnel, roof access stories, "secret spot" with directions requests).
- HIGH: recurring student/city rituals, streaks, organized hikes, pranks, newspaper-named traditions, "does anyone know where X is" oral rumor threads about a local place.
- LOWER: quirky social threads still tied to campus life and proper nouns in the post.
- LOWEST / AVOID as a Wander quest unless NOTHING higher exists in the sources: national or generic "college access" anecdotes; counselor/admissions pressure stories; "crab bucket" or other abstract metaphors; Rwanda/Grambling/remote place examples used to illustrate a general point; any story where the target school is just where someone "got in" or "chose" but the plot is not about that campus, its places, or its community stories. If your only material is in this bucket, return {"quests": []} or pick a different SOURCE block that matches HIGHEST/HIGH.

"social" category means campus-specific group traditions or challenges, NOT "social issues" or equity essays. Prefer urban_exploration or tradition when a thread is about finding a cave, the Dish, or similar.

Hard grounding rules (violate these and the product is wrong):
1) Numbered blocks [SOURCE n] REDDIT or [SOURCE n] WEB are the only evidence. Reddit-only is valid; do not return empty just because there are no WEB sources.
2) FORBIDDEN: inventing secret societies, basement cabals, cryptic symbols, initiation scenes, or meetings not in the text.
3) REQUIRED "sourcesSay": 3-10 sentences quoting or tightly paraphrasing ONLY the SOURCE blocks. Use exact proper nouns from the text (Encyclopedia Cave, the Dish, quarry, etc.). Say what is unknown (e.g. "coordinates not in thread") if so.
4) "description" and "steps": LAWFUL follow-up only (archives, keyword search in student paper, open maps, official land managers). No DM-for-trespass directions; you may note that some comments offer DMs in sourcesSay without reproducing coordinates. Never add proper nouns not in sourcesSay.
5) "title" and "loreBlurb" must echo a concrete hook from the sources (place name, rumor name, "Encyclopedia Cave", not generic "Mentality" or "Cultural challenge" unless those exact social-science frames are the only content—and then prefer returning fewer/no quests if better blocks exist.
6) Order quests: most place-anchored and specific first.
7) "confidence": low for thin or single-comment rumor; high only when several details align in text.

Safety: no trespassing, lock picking, or breaking rules. Fenced or ambiguous access: use warnings restricted_or_unclear_access; say verify land rules and do not enter closed areas.

Output JSON only.

Every quest object MUST include these keys (use null only where noted):
- title (string)
- sourcesSay (string, required for every quest you return; 3+ sentences from SOURCE blocks)
- loreBlurb (string)
- description (string)
- steps (array of strings, at least 1)
- locationName (string or null)
- lat (number or null), lng (number or null)
- difficulty (integer 1-5), safetyScore (integer 1-5)
- warnings (array of strings, may be empty)
- category (string, one of: tradition, urban_exploration, social, history, challenge)
- confidence (number from 0 to 1)

Categories:
- tradition: recurring ritual / campus lore
- urban_exploration: places, legal walking routes, orientation to a named outdoor/story place
- social: group challenge or meetup (campus-specific, not policy debate)
- history: archives, plaques, research
- challenge: light puzzles, scavenger hunts

Warnings (exact strings only, or empty array):
night_common, physical, restricted_or_unclear_access, height, group_recommended, weather_dependent

safetyScore: 1 very safe; 5 serious risk or access ambiguity. difficulty: 1 trivial, 5 demanding. Unknown coordinates: lat and lng null.

Tie locationName to SOURCE wording when a place label appears in the user message.

OUTPUT CONTRACT (enforced; invalid JSON is rejected and retried):
- Every object in "quests" MUST have non-empty "title" (not the literal "Untitled", not whitespace).
- "sourcesSay" is REQUIRED and MUST be 3+ full sentences, rooted in the [SOURCE n] text, usually ≥120 characters. Never "".
- "loreBlurb" and "description" must be non-trivial (not a single word like "No" or "None").
- If you cannot meet this for a topic, omit that quest. Return {"quests":[]} rather than half-empty quest objects.
Return shape: {"quests":[...]}.
Return {"quests":[]} if every block is off-topic, pure politics, travel spam, OR if the only on-topic content is the LOWEST bucket and no HIGHEST/HIGH row exists, OR you cannot meet OUTPUT CONTRACT. Otherwise return 1-3 quests that follow the PRIORITY section (Encyclopedia Cave / Dish / quarry style beats generic admissions anecdote).`;

/** When strict pass is empty, still ground in SOURCES but allow weaker / LOWER-bucket material so curators get a starting point. */
const SYSTEM_RELAXED = `You extract evidence-grounded "quests" for an app called Wander. You are in RELAXED follow-up mode: a previous pass returned zero quests from the same SOURCE blocks.

Your job: return 1-3 quests if ANY [SOURCE] block plausibly touches local student life, campus, named places, rumors, oral threads, "has anyone…", or city/university life tied to the target, even if mixed with generic discussion. You MAY use LOWER-bucket and thin rumor threads; still do NOT invent facts, societies, or rituals. Every claim in sourcesSay must still trace to a SOURCE line.

If the corpus is entirely off-topic, spam, or the institution/place is never really discussed, return {"quests":[]}.

Hard rules (unchanged from strict mode):
- Evidence only from numbered [SOURCE n] blocks. sourcesSay: 3-10 sentences grounded in those blocks. confidence usually 0.2–0.5 for mixed material; use lower when uncertain.
- No trespassing directions. Never add proper nouns not in sourcesSay.
- "social" = campus traditions, not social-issues debate.

Same OUTPUT CONTRACT as the strict pass: no empty "title" or "sourcesSay"; 3+ sentences in "sourcesSay"; do not return placeholder quests.

Output JSON: same keys as before. {"quests": [...]}`;

const MIN_CHARS_RECOVERY = 2000;
const MIN_CHARS_STUB = 5000;

export type QuestCompilePath = "strict" | "relaxed" | "stub" | "none";

export type ParseQuestsResult = {
  quests: ParsedQuest[];
  compilePath: QuestCompilePath;
};

function buildUserMessage(params: {
  pageTitle: string;
  text: string;
  sourceUrl: string;
  anchoring?: { label: string; lat?: number; lng?: number };
}, extra: string) {
  const anchor =
    params.anchoring &&
    `Target place (user): ${params.anchoring.label}\n` +
      (params.anchoring.lat != null && params.anchoring.lng != null
        ? `Approximate map center from geocoder: ${params.anchoring.lat}, ${params.anchoring.lng}\n`
        : "") +
      `Relevance: prioritize SOURCE blocks that describe places, routes, or campus-specific rumors for this target over blocks where the place name is only background to a general education or admissions anecdote.\n`;
  return `${extra}${anchor ?? ""}Reference URLs (for citation context only; evidence must still come from SOURCE blocks below):
${params.sourceUrl}

Page title: ${params.pageTitle}

--- BEGIN NUMBERED SOURCE TEXT ---
${params.text}
--- END NUMBERED SOURCE TEXT ---`;
}

function makeCorpusStubQuest(params: {
  placeLabel: string;
  pageTitle: string;
  sourceUrl: string;
  charCount: number;
  anchoring?: { label: string; lat?: number; lng?: number };
}): ParsedQuest {
  const { placeLabel, pageTitle, sourceUrl, charCount, anchoring } = params;
  const blurb = `A ${charCount.toLocaleString()}-char gather was saved, but the model could not name a high-confidence quest. This draft is for curation: pull one real hook from the [SOURCE] blocks.`;

  return {
    title: `Curate a quest from gathered lore — ${placeLabel.slice(0, 88)}`.slice(0, 200),
    loreBlurb: blurb.slice(0, 500),
    description: `What the sources say (must match numbered SOURCE CHUNKS; no new facts below this line):\nThe full corpus is in the RawScrape for this run; the automated quest extractor did not assign a high-confidence quest. The SOURCE blocks below the scrape metadata contain Reddit and/or web text about "${placeLabel}". Read them and replace this description with 3-8 sentences that only quote or paraphrase what actually appears, before publishing.

Quest framing and how to engage (still no new factual claims):
Pick one thread or article that names a place, route, or tradition, then edit this quest so title, lore, and steps match the sources. Delete this template language when done.

Context: ${sourceUrl.slice(0, 1500)}${sourceUrl.length > 1500 ? "…" : ""}

Page title: ${pageTitle.slice(0, 300)}`,
    steps: [
      `In the admin lab, open the linked RawScrape and scan [SOURCE n] blocks for a strong proper noun, trail, or tradition for ${placeLabel}.`,
      "Edit this draft: new title, lore, and description with every claim verifiable in the scrape.",
      "Keep follow-up steps lawful: archives, official hours, and public access only—no secret access instructions.",
    ],
    locationName: placeLabel.length ? placeLabel.slice(0, 200) : null,
    lat:
      anchoring?.lat != null && Number.isFinite(anchoring.lat) && anchoring.lat >= -90 && anchoring.lat <= 90
        ? anchoring.lat
        : null,
    lng:
      anchoring?.lng != null && Number.isFinite(anchoring.lng) && anchoring.lng >= -180 && anchoring.lng <= 180
        ? anchoring.lng
        : null,
    difficulty: 1,
    safetyScore: 1,
    warnings: [],
    category: "history",
    confidence: 0.08,
  };
}

export async function parseQuestsWithRecovery(params: {
  pageTitle: string;
  text: string;
  sourceUrl: string;
  anchoring?: { label: string; lat?: number; lng?: number };
}): Promise<ParseQuestsResult> {
  if (/^(1|true|yes)$/i.test(process.env.LORE_SKIP_QUEST_RECOVERY ?? "")) {
    const quests = await runModelExtract(params, SYSTEM, "", 0.08);
    return { quests, compilePath: quests.length > 0 ? "strict" : "none" };
  }

  const first = await runModelExtract(params, SYSTEM, "", 0.08);
  if (first.length > 0) {
    return { quests: first, compilePath: "strict" };
  }

  if (params.text.length < MIN_CHARS_RECOVERY) {
    return { quests: [], compilePath: "none" };
  }

  const placeForHint =
    params.anchoring?.label?.trim() || params.pageTitle.slice(0, 120) || "the target place";
  const followUp = `FOLLOW-UP: A prior model pass returned {"quests":[]} for these exact SOURCE blocks. Re-read them. You are in RELAXED mode. Return 1-3 quests if the combined text is even loosely about ${placeForHint} (students, campus, city, alumni, dorms, sports, "anyone else hear…" rumors, or proper nouns). Reject the empty list unless everything is total spam, boilerplate, or has nothing to do with the place. Same grounding rules: sourcesSay must cite the blocks; never invent.`;

  const second = await runModelExtract(params, SYSTEM_RELAXED, followUp + "\n\n", 0.12);
  if (second.length > 0) {
    return { quests: second, compilePath: "relaxed" };
  }

  if (params.text.length < MIN_CHARS_STUB || /^(1|true|yes)$/i.test(process.env.LORE_NO_QUEST_STUB ?? "")) {
    return { quests: [], compilePath: "none" };
  }

  const placeLabel = params.anchoring?.label?.trim() || params.pageTitle.slice(0, 120) || "this place";
  return {
    quests: [
      makeCorpusStubQuest({
        placeLabel,
        pageTitle: params.pageTitle,
        sourceUrl: params.sourceUrl,
        charCount: params.text.length,
        anchoring: params.anchoring,
      }),
    ],
    compilePath: "stub",
  };
}

function parseAndNormalizeModelJson(raw: string): ParsedQuest[] {
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Model returned non-JSON");
  }
  const parsed = RawExtractSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Model JSON failed validation: ${parsed.error.message}`);
  }
  return parsed.data.quests.slice(0, 5).map(normalizeQuest);
}

async function runModelExtract(
  params: {
    pageTitle: string;
    text: string;
    sourceUrl: string;
    anchoring?: { label: string; lat?: number; lng?: number };
  },
  system: string,
  userPrefix: string,
  temperature: number,
): Promise<ParsedQuest[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const user = buildUserMessage(params, userPrefix);
  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const maxOut = 5000;

  const c1 = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxOut,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw1 = c1.choices[0]?.message?.content;
  if (!raw1) throw new Error("Empty model response");
  const list1 = parseAndNormalizeModelJson(raw1);
  const good1 = list1.filter((q) => !isPlaceholderQuest(q));
  if (good1.length > 0) {
    return good1;
  }
  if (list1.length === 0) {
    return [];
  }

  if (/^(1|true|yes)$/i.test(process.env.LORE_NO_QUEST_REPAIR_TURN ?? "")) {
    return [];
  }

  const t2 = Math.min(0.25, Math.max(0.05, temperature + 0.1));
  const c2 = await client.chat.completions.create({
    model,
    temperature: t2,
    max_tokens: maxOut,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: raw1 },
      { role: "user", content: REPAIR_TURN },
    ],
  });
  const raw2 = c2.choices[0]?.message?.content;
  if (!raw2) {
    return [];
  }
  const list2 = parseAndNormalizeModelJson(raw2);
  return list2.filter((q) => !isPlaceholderQuest(q));
}

export async function parseQuestsFromText(params: {
  pageTitle: string;
  text: string;
  sourceUrl: string;
  anchoring?: { label: string; lat?: number; lng?: number };
}): Promise<ParseQuestsResult> {
  return parseQuestsWithRecovery(params);
}

export function slugify(s: string) {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}
