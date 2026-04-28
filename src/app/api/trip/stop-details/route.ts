import { NextResponse } from "next/server";
import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchPageText } from "@/lib/scrape";
import { parseStopDetailsFromPage } from "@/lib/parse-stop-details";
import { getGoogleGeoKeyFromEnv } from "@/lib/trip-geocode";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const inMemoryCache = new Map<string, { at: number; body: unknown }>();

const BodySchema = z.object({
  stop: z.object({
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(500),
    category: z.string().min(1).max(80),
    website: z.string().url().nullish(),
    ticketingUrl: z.string().url().nullish(),
    placeId: z.string().nullish(),
  }),
});

function guessInfoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    // Google Maps cid pages are not a real venue website and are frequently blocked/JS-heavy.
    // Treat as "no usable website" and fall back to Places Details (placeId) when possible.
    const isGoogleMaps = /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === "/";
    if (isGoogleMaps && u.searchParams.has("cid")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isBlockedCandidateHost(host: string): boolean {
  const h = host.toLowerCase();
  // for stop websites, avoid obvious non-official aggregators
  return (
    h.includes("google.") ||
    h.includes("gstatic.") ||
    h.includes("facebook.") ||
    h.includes("instagram.") ||
    h.includes("yelp.") ||
    h.includes("tripadvisor.") ||
    h.includes("opentable.") ||
    h.includes("doordash.") ||
    h.includes("ubereats.") ||
    h.includes("postmates.") ||
    h.includes("grubhub.")
  );
}

function decodeDdgRedirect(href: string): string | null {
  try {
    const abs = href.startsWith("//") ? `https:${href}` : href.startsWith("/") ? `https://duckduckgo.com${href}` : href;
    const u = new URL(abs);
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (u.hostname.includes("duckduckgo")) return null;
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* ignore */
  }
  return null;
}

async function duckLiteFirstOfficialUrl(query: string): Promise<string | null> {
  const u = new URL("https://lite.duckduckgo.com/lite/");
  u.searchParams.set("q", query);
  const res = await fetch(u.toString(), {
    headers: {
      "user-agent":
        "Wander/0.1 (+https://github.com/GunmetalPoem/wander) stop-details search; educational project - contact if problematic",
      accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const decoded = decodeDdgRedirect(href) ?? (href.startsWith("http") ? href : null);
    if (!decoded) return;
    let host = "";
    try {
      host = new URL(decoded).hostname;
    } catch {
      return;
    }
    if (isBlockedCandidateHost(host)) return;
    out.push(decoded);
  });
  for (const cand of out) {
    const usable = guessInfoUrl(cand);
    if (usable) return usable;
  }
  return null;
}

type GooglePlaceDetails = {
  website?: string;
  url?: string;
};

async function googlePlaceDetailsWebsite(
  placeId: string,
  key: string,
): Promise<{ websiteUrl: string | null; status: string | null; errorMessage: string | null }> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  u.searchParams.set("fields", "website,url");
  u.searchParams.set("place_id", placeId);
  u.searchParams.set("key", key);
  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return { websiteUrl: null, status: `HTTP_${res.status}`, errorMessage: null };
  const j = (await res.json()) as { status: string; error_message?: string; result?: GooglePlaceDetails };
  if (j.status === "REQUEST_DENIED" || j.status === "INVALID_REQUEST") {
    console.error("[trip-stop-details] Google Place Details:", j.status, j.error_message);
    return { websiteUrl: null, status: j.status, errorMessage: j.error_message ?? null };
  }
  if (j.status !== "OK" || !j.result) {
    return { websiteUrl: null, status: j.status ?? null, errorMessage: j.error_message ?? null };
  }
  const site = j.result.website?.trim();
  if (site) return { websiteUrl: site, status: "OK", errorMessage: null };
  // `url` is usually the Google Maps page; not helpful for scraping, but keep as fallback only if non-cid.
  const mapsUrl = j.result.url?.trim();
  if (mapsUrl) {
    const usable = guessInfoUrl(mapsUrl);
    if (usable) return { websiteUrl: usable, status: "OK", errorMessage: null };
  }
  return { websiteUrl: null, status: "OK", errorMessage: null };
}

async function fetchHtml(url: string): Promise<{ title: string; html: string }> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "WanderBot/0.1 (+https://github.com/GunmetalPoem/wander) trip details scraper; educational project - contact site owner if problematic",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const h1 = $("h1").first().text().trim();
  const docTitle = $("title").first().text().trim();
  const title = (ogTitle || h1 || docTitle || url).slice(0, 200);
  return { title, html };
}

function extractMainTextFromHtml(html: string, maxChars: number): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  const main = $("main").first();
  const root = main.length ? main : $("article").first().length ? $("article").first() : $("body");
  const text = root.text().replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)} [truncated]` : text;
}

function pickRelatedUrls(
  baseUrl: string,
  html: string,
): { ticketUrl: string | null; menuUrl: string | null } {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const ticketCands: { url: string; score: number }[] = [];
  const menuCands: { url: string; score: number }[] = [];

  $("a[href]").each((_, a) => {
    const href = String($(a).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(u.protocol)) return;
    // Prefer same site to reduce noise and blocks (allow subdomains like tickets.example.com).
    const baseHost = base.host.toLowerCase();
    const uHost = u.host.toLowerCase();
    const sameHost = uHost === baseHost;
    const sameSite = sameHost || uHost.endsWith(`.${baseHost}`) || baseHost.endsWith(`.${uHost}`);
    if (!sameSite) return;

    const text = $(a).text().trim().toLowerCase();
    const path = (u.pathname + u.search).toLowerCase();
    const hay = `${text} ${path}`;

    const ticketKeywords = [
      ["ticket", 6],
      ["tickets", 6],
      ["admission", 6],
      ["pricing", 5],
      ["prices", 5],
      ["plan your visit", 4],
      ["hours", 3],
      ["visit", 2],
      ["buy", 2],
      ["reserve", 2],
    ] as const;
    const menuKeywords = [
      ["menu", 8],
      ["food", 3],
      ["dinner", 2],
      ["lunch", 2],
      ["brunch", 2],
      ["drinks", 2],
      ["order", 2],
      ["takeout", 2],
    ] as const;

    let tScore = 0;
    for (const [k, w] of ticketKeywords) if (hay.includes(k)) tScore += w;
    let mScore = 0;
    for (const [k, w] of menuKeywords) if (hay.includes(k)) mScore += w;

    const urlStr = u.toString();
    if (tScore > 0) ticketCands.push({ url: urlStr, score: tScore });
    if (mScore > 0) menuCands.push({ url: urlStr, score: mScore });
  });

  ticketCands.sort((a, b) => b.score - a.score);
  menuCands.sort((a, b) => b.score - a.score);
  return { ticketUrl: ticketCands[0]?.url ?? null, menuUrl: menuCands[0]?.url ?? null };
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

  const { stop } = parsed.data;
  let websiteUrl = guessInfoUrl(stop.website);
  const providedTicketUrl = guessInfoUrl(stop.ticketingUrl);
  const googleKey = getGoogleGeoKeyFromEnv();
  let googleDiag: { status: string | null; errorMessage: string | null } | null = null;
  if (!websiteUrl && stop.placeId && googleKey) {
    const fromGoogle = await googlePlaceDetailsWebsite(stop.placeId, googleKey);
    googleDiag = { status: fromGoogle.status, errorMessage: fromGoogle.errorMessage };
    websiteUrl = guessInfoUrl(fromGoogle.websiteUrl);
  }
  // If Google Details is OK but doesn't have a website (common), fall back to a lightweight web search.
  if (!websiteUrl && (googleDiag?.status === "OK" || googleDiag?.status === "ZERO_RESULTS")) {
    const q = `${stop.name} ${stop.address} official site`;
    websiteUrl = await duckLiteFirstOfficialUrl(q);
  }
  const url = providedTicketUrl ?? websiteUrl;
  if (!url) {
    const diag =
      stop.placeId == null
        ? "Missing placeId (stop was not resolved via Google Places)."
        : googleKey == null
          ? "Google key not detected by server (check env var name)."
          : googleDiag?.status
            ? `Google Place Details status: ${googleDiag.status}${googleDiag.errorMessage ? ` (${googleDiag.errorMessage})` : ""}`
            : "Google Place Details did not return a website.";
    return NextResponse.json({
      details: {},
      hint:
        `No usable website for this stop. ${diag} If the stop only had a Google Maps cid link, we need Place Details to return a real website URL.`,
    });
  }

  const cacheKey = `${stop.name}::${url}`;
  const cached = inMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body);
  }

  let page: { title: string; text: string };
  let ticketUrl: string | null = null;
  let menuUrl: string | null = null;
  try {
    // Single fetch for HTML; derive both text + candidate subpages.
    const raw = await fetchHtml(url);
    page = { title: raw.title, text: extractMainTextFromHtml(raw.html, 18_000) };
    const rel = pickRelatedUrls(url, raw.html);
    ticketUrl = providedTicketUrl ?? rel.ticketUrl;
    menuUrl = rel.menuUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  let extraText = "";
  if (ticketUrl && ticketUrl !== url) {
    try {
      const t = await fetchPageText(ticketUrl, { maxTextChars: 18_000 });
      extraText = `\n\n--- RELATED PAGE: ${t.title} (${ticketUrl}) ---\n${t.text}\n`;
    } catch {
      // ignore ticket page failures; keep base page.
    }
  }
  if (menuUrl && menuUrl !== url && menuUrl !== ticketUrl) {
    try {
      const m = await fetchPageText(menuUrl, { maxTextChars: 18_000 });
      extraText += `\n\n--- RELATED PAGE: ${m.title} (${menuUrl}) ---\n${m.text}\n`;
    } catch {
      // ignore
    }
  }

  try {
    const primarySourceUrl = ticketUrl ?? url;
    const details = await parseStopDetailsFromPage({
      stopName: stop.name,
      stopCategory: stop.category,
      pageTitle: page.title,
      pageText: `${page.text}${extraText}`.slice(0, 26_000),
      sourceUrl: primarySourceUrl,
    });
    const hint =
      !details.openingHoursText?.length &&
      !details.menuHighlights?.length &&
      !details.admission &&
      !details.fees &&
      !details.ticketingUrl
        ? "No structured details found on the scraped pages (site may be JS-rendered or prices/hours are behind interactive widgets). Try enabling Ferret (LORE_USE_FERRET=1) for JS-heavy sites."
        : undefined;
    const responseBody = {
      details: {
        ...details,
        ticketingUrl: details.ticketingUrl ?? ticketUrl ?? undefined,
        deepSourceUrl: details.deepSourceUrl ?? primarySourceUrl,
        // Not part of schema, but harmless if present in response; client ignores unknown keys.
      },
      hint,
    };
    inMemoryCache.set(cacheKey, { at: Date.now(), body: responseBody });
    return NextResponse.json(responseBody);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

