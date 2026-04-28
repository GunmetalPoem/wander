import OpenAI from "openai";
import { z } from "zod";

const StopDetailsSchema = z.object({
  deepSourceUrl: z.string().url().optional(),
  openingHoursText: z.array(z.string()).optional(),
  admission: z
    .object({
      summary: z.string().optional(),
      member: z.string().optional(),
      adult: z.string().optional(),
      student: z.string().optional(),
      child: z.string().optional(),
      teen: z.string().optional(),
      senior: z.string().optional(),
      freeDays: z.string().optional(),
    })
    .optional(),
  fees: z
    .object({
      parking: z.string().optional(),
      permit: z.string().optional(),
      entry: z.string().optional(),
    })
    .optional(),
  menuHighlights: z.array(z.string()).optional(),
  ticketingUrl: z.string().url().optional(),
});

export type ParsedStopDetails = z.infer<typeof StopDetailsSchema>;

const SYSTEM = `You extract practical visitor info about a single trip stop from scraped webpage text.
Return ONLY a JSON object (no markdown) matching this schema:
{
  "openingHoursText"?: string[],        // e.g. ["Mon–Fri 10–5", "Sat–Sun 10–6"] or ["See website for seasonal hours"]
  "admission"?: { "summary"?: string, "member"?: string, "adult"?: string, "student"?: string, "teen"?: string, "child"?: string, "senior"?: string, "freeDays"?: string },
  "fees"?: { "parking"?: string, "permit"?: string, "entry"?: string },
  "menuHighlights"?: string[],          // 3-10 representative items/categories; only if the page clearly contains menu info
  "ticketingUrl"?: string               // if the page includes a ticket/reservation link
}

Rules:
- Do NOT invent. If the page does not clearly say it, omit the field.
- Prefer concise, user-facing text with units/currency as written.
- For prices: ONLY populate admission fields when you can see a specific currency amount (like "$30") in the text.
- If hours vary by season/day, summarize conservatively ("Seasonal—check site") and include the most specific reliable snippet.
- menuHighlights must be short phrases, not paragraphs.`;

export async function parseStopDetailsFromPage(params: {
  stopName: string;
  stopCategory: string;
  pageTitle: string;
  pageText: string;
  sourceUrl: string;
}): Promise<ParsedStopDetails> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const user = `Stop name: ${params.stopName}
Category: ${params.stopCategory}
Source URL: ${params.sourceUrl}
Page title: ${params.pageTitle}

--- BEGIN PAGE TEXT ---
${params.pageText}
--- END PAGE TEXT ---`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });

  const raw = resp.choices[0]?.message?.content;
  if (!raw) return {};

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }

  const parsed = StopDetailsSchema.safeParse(json);
  if (!parsed.success) return {};

  return {
    ...parsed.data,
    deepSourceUrl: params.sourceUrl,
  };
}

