import { NextResponse } from "next/server";
import { assertAdminSecret } from "@/lib/admin-auth";
import { type GatherDebug, gatherCorpusForLocation } from "@/lib/location-corpus";
import { parseQuestsFromText, slugify } from "@/lib/parse-quest";
import { prisma } from "@/lib/prisma";
import { fetchPageText } from "@/lib/scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Parsed = Awaited<ReturnType<typeof parseQuestsFromText>>["quests"];

async function persistParsedQuests(params: {
  rawId: string;
  questsData: Parsed;
  sourceUrl: string;
}) {
  const created = [];
  for (const q of params.questsData) {
    let row: Awaited<ReturnType<typeof prisma.quest.create>> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = slugify(q.title);
      try {
        row = await prisma.quest.create({
          data: {
            slug,
            title: q.title,
            loreBlurb: q.loreBlurb,
            description: q.description,
            steps: JSON.stringify(q.steps),
            locationName: q.locationName ?? undefined,
            lat: q.lat ?? undefined,
            lng: q.lng ?? undefined,
            difficulty: q.difficulty,
            safetyScore: q.safetyScore,
            warnings: JSON.stringify(q.warnings),
            category: q.category,
            status: "draft",
            confidence: q.confidence,
            sourceUrl: params.sourceUrl,
            rawScrapeId: params.rawId,
          },
        });
        break;
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "P2002" && attempt < 4) continue;
        throw e;
      }
    }
    if (!row) {
      throw new Error("Could not allocate unique slug for a quest row.");
    }
    created.push(row);
  }
  return created;
}

export async function POST(req: Request) {
  try {
    assertAdminSecret(req);
  } catch (e) {
    const err = e as Error & { statusCode?: number };
    if (err.statusCode === 401) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw e;
  }

  let body: { url?: string; location?: string; geo?: { name: string; lat: number; lng: number } };
  try {
    body = (await req.json()) as { url?: string; location?: string; geo?: { name: string; lat: number; lng: number } };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const location = body.location?.trim();
  const url = body.url?.trim();
  let confirmedGeo: { name: string; lat: number; lng: number } | undefined;
  if (body.geo && typeof body.geo.name === "string" && body.geo.name.trim()) {
    const lat = body.geo.lat;
    const lng = body.geo.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      confirmedGeo = { name: body.geo.name.trim(), lat, lng };
    }
  }

  if (!location && !url) {
    return NextResponse.json({ error: "Provide `location` (place name) or `url` (advanced)." }, { status: 400 });
  }

  let page: { title: string; text: string };
  let rawUrl: string;
  let anchoring: { label: string; lat?: number; lng?: number } | undefined;
  let sourcesSummary: string[] | undefined;
  let gatherDebug: GatherDebug | undefined;
  let resolvedPlaceLabel: string | undefined;

  if (location) {
    let corpus;
    try {
      corpus = await gatherCorpusForLocation(location, { confirmedGeo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Location gather failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    resolvedPlaceLabel = corpus.geo?.name ?? location;
    gatherDebug = corpus.debug;

    if (corpus.text.length < 200) {
      return NextResponse.json(
        {
          error:
            "Very little text was found for that place. Try a larger city, a university name, or spelling variants. Reddit or DuckDuckGo may also be temporarily unreachable.",
          gather: gatherDebug,
          usedLocation: resolvedPlaceLabel,
        },
        { status: 422 },
      );
    }

    page = { title: corpus.pageTitle, text: corpus.text };
    rawUrl = `lore://location?q=${encodeURIComponent(location)}${corpus.geo ? `&geoName=${encodeURIComponent(corpus.geo.name)}` : ""}`;
    sourcesSummary = corpus.sources;
    if (corpus.geo) {
      anchoring = { label: corpus.geo.name, lat: corpus.geo.lat, lng: corpus.geo.lng };
    } else {
      anchoring = { label: location };
    }
  } else {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url!);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Only http(s) URLs are allowed" }, { status: 400 });
    }

    try {
      page = await fetchPageText(parsedUrl.toString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fetch failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    if (page.text.length < 120) {
      return NextResponse.json(
        { error: "Extracted text too short — page may require JavaScript or block scrapers." },
        { status: 422 },
      );
    }

    rawUrl = parsedUrl.toString();
  }

  const raw = await prisma.rawScrape.create({
    data: {
      url: rawUrl,
      rawText: page.text,
    },
  });

  const parserSourceUrl =
    location && sourcesSummary?.length
      ? sourcesSummary.slice(0, 5).join(" | ")
      : rawUrl;

  /** Single-page scrape must use same [SOURCE n] contract as location gather. */
  const parserText = location
    ? page.text
    : `[SOURCE 1] WEB ${rawUrl}\nTITLE: ${page.title}\n${page.text}`;

  let questsData: Parsed;
  let questCompile: { path: "strict" | "relaxed" | "stub" | "none" } | undefined;
  try {
    const parsed = await parseQuestsFromText({
      pageTitle: page.title,
      text: parserText,
      sourceUrl: parserSourceUrl,
      anchoring,
    });
    questsData = parsed.quests;
    questCompile = { path: parsed.compilePath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: msg, rawScrapeId: raw.id, gather: gatherDebug }, { status: 502 });
  }

  if (questsData.length === 0) {
    return NextResponse.json(
      {
        code: "no_quests_extracted" as const,
        error:
          "The parser returned zero quests. That can happen when the gathered text has no passage that clearly matches strict quest rules (inventing rituals is not allowed) or the model is uncertain. A RawScrape was still saved for debugging.",
        hint:
          "Try Advanced with one strong URL (article or thread), a more specific place (e.g. full school name), or a different phrasing. Discovery uses Reddit and DuckDuckGo queries, not random URLs.",
        rawScrapeId: raw.id,
        gather: gatherDebug,
        sources: sourcesSummary,
        usedLocation: resolvedPlaceLabel,
      },
      { status: 422 },
    );
  }

  let created;
  try {
    created = await persistParsedQuests({
      rawId: raw.id,
      questsData,
      sourceUrl: parserSourceUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: msg, rawScrapeId: raw.id, gather: gatherDebug }, { status: 500 });
  }

  return NextResponse.json({
    rawScrapeId: raw.id,
    createdQuests: created.map((q) => ({ id: q.id, slug: q.slug, title: q.title })),
    sources: sourcesSummary,
    usedLocation: resolvedPlaceLabel,
    gather: gatherDebug,
    questCompile,
  });
}
