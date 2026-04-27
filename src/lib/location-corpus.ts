import * as cheerio from "cheerio";
import { fetchPageText } from "@/lib/scrape";
import {
  redditOAuthEnabled,
  redditSearchPermalinksOAuth,
  redditSubredditSearchPermalinksOAuth,
  redditThreadJsonOAuth,
} from "@/lib/reddit-api";
import { type Geo, geocodeFirst } from "@/lib/geocode";

/** ASCII-only: fetch() header values must be ByteString. */
const UA =
  "Lore/0.1 (+https://github.com) location gatherer; educational project - contact if problematic";

export type { Geo };

/** Skip travel-brochure / SEO pages; we want forums, student posts, messy long-tail HTML. */
const BLOCKED_HOST_SUBSTRINGS = [
  "wikipedia.org",
  "wikimedia.org",
  "wikivoyage.org",
  "tripadvisor.",
  "viator.",
  "getyourguide.",
  "lonelyplanet.",
  "timeout.com",
  "google.com",
  "gstatic.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "fb.com",
  "pinterest.com",
  "tiktok.com",
  "yelp.com",
  "booking.com",
  "hotels.com",
  "expedia.",
  "travelocity.",
  "orbitz.com",
  "kayak.com",
  "trip.com",
  "hotwire.com",
  "usnews.com",
  "niche.com",
  "collegeconfidential.com",
  "reddit.com/gallery",
  "news.google.",
  "apple.news",
  "politico.com",
  "thehill.com",
  "foxnews.com",
  "cnn.com",
  "msnbc.com",
  "realclearpolitics",
  "dailykos.com",
  "breitbart",
];

/** Appended to DuckDuckGo queries to avoid national-politics SEO blobs. ASCII only. */
const DDG_NEG =
  " -trump -biden -impeachment -election -president -maga -\"white house\" -congress -\"january 6\"";

/** Reddit search supports minus terms on global search. */
const REDDIT_NEG = " -Trump -Biden -MAGA -impeachment -election -Congress -president";

function hostBlocked(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED_HOST_SUBSTRINGS.some((s) => h.includes(s));
}

function countNeedleHits(lower: string, needles: string[]): number {
  let hits = 0;
  for (const needle of needles) {
    const q = needle.toLowerCase();
    if (q.length < 3) continue;
    let i = 0;
    while ((i = lower.indexOf(q, i)) !== -1) {
      hits++;
      i += Math.max(1, q.length);
    }
  }
  return hits;
}

function buildRelevanceNeedles(location: string, geo: Geo | null): string[] {
  const out: string[] = [];
  const loc = location.trim();
  if (loc.length >= 3) out.push(loc);
  if (geo?.name) {
    for (const p of geo.name.split(",").map((s) => s.trim())) {
      if (p.length < 4) continue;
      if (/^(united states|usa|u\.s\.a?\.?)$/i.test(p)) continue;
      out.push(p);
    }
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isNationalPoliticsBlob(lower: string, needleHits: number): boolean {
  const pol = (
    lower.match(
      /\b(trump|donald trump|joe biden|\bbiden\b|maga|impeach|january\s*6|mar-?a-?lago|oval office|\brnc\b|\bdnc\b|white house)\b/gi,
    ) ?? []
  ).length;
  const campus = (
    lower.match(
      /\b(campus|undergraduate|quad|dorm|student tradition|ritual|stanford daily|registrar|provost|hoover|memorial church|gaieties|intramural|student org|undergrad)\b/gi,
    ) ?? []
  ).length;
  if (needleHits < 2 && pol >= 4) return true;
  if (pol >= 6 && campus <= 2 && needleHits < 12) return true;
  if (pol >= 3 && campus === 0 && needleHits < 6) return true;
  return false;
}

function passesLocalCorpusGate(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  const nh = countNeedleHits(lower, needles);
  if (nh < 1) return false;
  if (isNationalPoliticsBlob(lower, nh)) return false;
  return true;
}

function scoreChunk(text: string, needles: string[]): number {
  const lower = text.toLowerCase();
  let s = countNeedleHits(lower, needles) * 4;
  const campus = (
    lower.match(
      /\b(campus|tradition|ritual|quad|dorm|tunnel|cave|hike|dish|fountain|gaieties|stanford daily|undergraduate|alumni|secret spot|initiation|streak|prank)\b/gi,
    ) ?? []
  ).length;
  s += campus * 3;
  const pol = (lower.match(/\b(trump|biden|maga|impeachment|white house)\b/gi) ?? []).length;
  s -= pol * 6;
  return s;
}

type RedditBundle = { text: string; url: string };

function rankRedditBundles(bundles: RedditBundle[], needles: string[], want: number): RedditBundle[] {
  const gated = bundles.filter((b) => passesLocalCorpusGate(b.text, needles));
  if (gated.length >= Math.min(want, 4)) return gated.slice(0, want);
  const ranked = [...bundles]
    .map((b) => ({ b, s: scoreChunk(b.text, needles) }))
    .sort((a, b) => b.s - a.s);
  const positive = ranked.filter((x) => x.s > 0).map((x) => x.b);
  if (positive.length >= 2) return positive.slice(0, want);
  return ranked.slice(0, want).map((x) => x.b);
}

type WebChunk = { title: string; text: string; url: string };

function rankWebChunks(chunks: WebChunk[], needles: string[], want: number): WebChunk[] {
  const gated = chunks.filter((w) => passesLocalCorpusGate(`${w.title}\n${w.text}`, needles));
  if (gated.length >= Math.min(want, 3)) return gated.slice(0, want);
  const ranked = [...chunks]
    .map((w) => ({ w, s: scoreChunk(`${w.title}\n${w.text}`, needles) }))
    .sort((a, b) => b.s - a.s);
  const positive = ranked.filter((x) => x.s > 0).map((x) => x.w);
  if (positive.length >= 2) return positive.slice(0, want);
  return ranked.slice(0, want).map((x) => x.w);
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

/** DuckDuckGo HTML: extract outbound URLs (uddg=) and direct http(s) links. */
async function duckHtmlSearch(base: string, query: string, limit: number): Promise<string[]> {
  const u = new URL(base);
  u.searchParams.set("q", query);
  const res = await fetch(u.toString(), {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const found: string[] = [];

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
    if (hostBlocked(host)) return;
    found.push(decoded);
  });

  // DDG sometimes embeds uddg= in script/data blobs not exposed as a[href]; sweep raw HTML.
  for (const m of Array.from(html.matchAll(/uddg=([^&"'\s<>]+)/gi))) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(m[1].replace(/\+/g, " "));
    } catch {
      continue;
    }
    if (!decoded.startsWith("http")) continue;
    let host = "";
    try {
      host = new URL(decoded).hostname;
    } catch {
      continue;
    }
    if (hostBlocked(host)) continue;
    found.push(decoded);
  }

  return dedupeUrls(found).slice(0, limit);
}

async function duckLiteUrls(query: string, limit: number): Promise<string[]> {
  const lite = await duckHtmlSearch("https://lite.duckduckgo.com/lite/", query, limit);
  if (lite.length >= 3) return lite;
  const html = await duckHtmlSearch("https://html.duckduckgo.com/html/", query, limit);
  return dedupeUrls([...lite, ...html]).slice(0, limit);
}

type RedditListingChild = {
  kind?: string;
  data?: {
    title?: string;
    selftext?: string;
    permalink?: string;
    body?: string;
    replies?: unknown;
  };
};

function walkCommentReplies(node: RedditListingChild, bodies: string[], budget: { left: number }) {
  if (budget.left <= 0) return;
  const d = node.data;
  if (!d) return;
  const body = d.body;
  if (typeof body === "string" && body.length > 30 && body !== "[removed]" && body !== "[deleted]") {
    bodies.push(body.replace(/\s+/g, " ").trim().slice(0, 900));
    budget.left--;
  }
  const rep = d.replies;
  if (rep === "" || rep == null) return;
  if (typeof rep !== "object" || !("data" in rep)) return;
  const children = (rep as { data?: { children?: RedditListingChild[] } }).data?.children;
  if (Array.isArray(children)) {
    for (const c of children) walkCommentReplies(c, bodies, budget);
  }
}

async function fetchRedditThreadBundle(permalink: string): Promise<{ text: string; url: string } | null> {
  const path = permalink.startsWith("/") ? permalink : `/${permalink}`;
  const clean = path.replace(/\/$/, "");
  const url = `https://www.reddit.com${clean}`;

  let json: unknown;
  if (redditOAuthEnabled()) {
    json = await redditThreadJsonOAuth(clean);
  } else {
    const res = await fetch(`${url}.json?raw_json=1&depth=3&limit=80&sort=top`, {
      headers: { "user-agent": UA, accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    json = (await res.json()) as unknown;
  }

  if (!json) return null;
  if (!Array.isArray(json) || json.length < 1) return null;

  const postListing = json[0] as { data?: { children?: RedditListingChild[] } };
  const post = postListing.data?.children?.[0]?.data;
  if (!post?.title) return null;

  const chunks: string[] = [];
  chunks.push(`TITLE: ${post.title}`);
  const st = (post.selftext ?? "").trim();
  if (st.length > 40) chunks.push(`POST: ${st.slice(0, 6000)}`);

  const commentsRoot = json[1] as { data?: { children?: RedditListingChild[] } } | undefined;
  const top = commentsRoot?.data?.children ?? [];
  const bodies: string[] = [];
  const budget = { left: 55 };
  for (const c of top) {
    if (c.kind === "more") continue;
    walkCommentReplies(c, bodies, budget);
  }
  if (bodies.length) {
    chunks.push("COMMENTS (thread, messy / oral tone):");
    chunks.push(bodies.join("\n---\n"));
  }

  const text = chunks.join("\n\n");
  if (text.length < 120) return null;
  return { text: text.slice(0, 12_000), url };
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (!norm.includes("/comments/") || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

async function redditSearchPermalinks(query: string, limit: number): Promise<string[]> {
  if (redditOAuthEnabled()) {
    const paths = await redditSearchPermalinksOAuth({ query, limit });
    return dedupePaths(paths.map((p) => (p.startsWith("/") ? p : `/${p}`))).slice(0, limit);
  }
  const u = new URL("https://www.reddit.com/search.json");
  u.searchParams.set("q", query);
  u.searchParams.set("limit", String(Math.min(25, Math.max(limit, 10))));
  u.searchParams.set("sort", "relevance");
  u.searchParams.set("type", "link");

  const res = await fetch(u.toString(), {
    headers: { "user-agent": UA, accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];

  const j = (await res.json()) as { data?: { children?: RedditListingChild[] } };
  const paths: string[] = [];
  for (const c of j.data?.children ?? []) {
    const p = c.data?.permalink;
    if (typeof p === "string" && p.includes("/comments/")) {
      paths.push(p.startsWith("/") ? p : `/${p}`);
    }
  }
  return dedupePaths(paths).slice(0, limit);
}

async function redditSubredditSearchPermalinks(params: {
  subreddit: string;
  query: string;
  limit: number;
  sort?: "top" | "relevance" | "new" | "comments";
  t?: "all" | "year" | "month";
}): Promise<string[]> {
  if (redditOAuthEnabled()) {
    const paths = await redditSubredditSearchPermalinksOAuth({
      subreddit: params.subreddit,
      query: params.query,
      limit: params.limit,
      sort: params.sort,
      t: params.t,
    });
    return dedupePaths(paths.map((p) => (p.startsWith("/") ? p : `/${p}`))).slice(0, params.limit);
  }
  const u = new URL(`https://www.reddit.com/r/${params.subreddit}/search.json`);
  u.searchParams.set("q", params.query);
  u.searchParams.set("restrict_sr", "1");
  u.searchParams.set("include_over_18", "on");
  u.searchParams.set("limit", String(Math.min(25, Math.max(params.limit, 10))));
  u.searchParams.set("sort", params.sort ?? "top");
  u.searchParams.set("t", params.t ?? "all");
  u.searchParams.set("type", "link");

  const res = await fetch(u.toString(), {
    headers: { "user-agent": UA, accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];

  const j = (await res.json()) as { data?: { children?: RedditListingChild[] } };
  const paths: string[] = [];
  for (const c of j.data?.children ?? []) {
    const p = c.data?.permalink;
    if (typeof p === "string" && p.includes("/comments/")) {
      paths.push(p.startsWith("/") ? p : `/${p}`);
    }
  }
  return dedupePaths(paths).slice(0, params.limit);
}

function guessSubreddits(location: string): string[] {
  const l = location.toLowerCase();
  const out: string[] = [];
  if (l.includes("stanford")) out.push("stanford");
  if (l.includes("berkeley") || l.includes("uc berkeley") || l.includes("u.c. berkeley")) out.push("berkeley");
  if (l.includes("ucla")) out.push("ucla");
  if (l.includes("usc")) out.push("USC");
  if (l.includes("nyu")) out.push("nyu");
  if (l.includes("mit")) out.push("mit");
  if (l.includes("harvard")) out.push("harvard");
  if (l.includes("yale")) out.push("yale");
  if (l.includes("princeton")) out.push("princeton");
  if (l.includes("columbia")) out.push("columbia");
  if (l.includes("caltech")) out.push("caltech");
  if (l.includes("ucsd")) out.push("UCSD");
  if (l.includes("uci")) out.push("UCI");
  // Generic fallback buckets that often contain “locals-only” posts
  out.push("AskReddit", "AskAcademia");
  return dedupeUrls(out.map((s) => s)).slice(0, 6);
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function placeTokens(location: string, geo: Geo | null): string[] {
  const raw = [location.trim()];
  if (geo?.name) {
    raw.push(geo.name);
    const first = geo.name.split(",")[0]?.trim();
    if (first && first !== location.trim()) raw.push(first);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const k = r.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function pageTextLimitForHost(host: string): number {
  const h = host.toLowerCase();
  if (h.endsWith(".edu")) return 10_000;
  if (h.includes("substack.com") || h.includes("medium.com")) return 7500;
  if (h.includes("daily") || h.includes("review") || h.includes("newspaper") || h.includes("independent"))
    return 7000;
  return 5200;
}

async function safeFetchPage(url: string): Promise<{ title: string; text: string; url: string } | null> {
  try {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (hostBlocked(host)) return null;
    const maxChars = pageTextLimitForHost(host);
    const { title, text } = await fetchPageText(url, { maxTextChars: maxChars });
    if (text.length < 150) return null;
    return { title, text, url };
  } catch {
    return null;
  }
}

/**
 * Corpus skewed away from encyclopedic / travel SEO:
 * deep Reddit threads (comments), DuckDuckGo Lite long-tail pages, optional geo.
 * No Wikipedia body text.
 */
export type GatherDebug = {
  /** Reddit thread bundles kept after ranking */
  redditThreads: number;
  /** Web pages fetched after ranking */
  webPages: number;
  /** Total characters in the assembled corpus text */
  charCount: number;
};

export async function gatherCorpusForLocation(
  rawLocation: string,
  options?: { confirmedGeo?: Geo },
): Promise<{
  pageTitle: string;
  text: string;
  sources: string[];
  geo: Geo | null;
  debug: GatherDebug;
}> {
  const location = rawLocation.trim();
  if (!location) {
    throw new Error("Location is empty");
  }

  const geo = options?.confirmedGeo ?? (await geocodeFirst(location));
  const tokens = placeTokens(location, geo);
  const needles = buildRelevanceNeedles(location, geo);

  const redditQueries: string[] = [];
  for (const t of tokens) {
    redditQueries.push(
      `${t} (urban legend OR folklore OR "campus myth" OR rumor OR hearsay)${REDDIT_NEG}`,
    );
    redditQueries.push(
      `${t} ("rite of passage" OR initiation OR ritual) (students OR university OR college)${REDDIT_NEG}`,
    );
    redditQueries.push(
      `${t} ("only people from" OR locals OR students) (secret OR hidden OR underground OR tunnel)${REDDIT_NEG}`,
    );
    redditQueries.push(`${t} (steam tunnel OR roof OR basement OR catacombs OR maintenance) story${REDDIT_NEG}`);
    redditQueries.push(
      `${t} (cave OR "sea cave" OR mountain OR ridge OR "the dish" OR dish) (tradition OR alumni OR students OR hike)${REDDIT_NEG}`,
    );
    redditQueries.push(
      `${t} (encyclopedia OR encyclopaedia OR "stack of books" OR "set of books") (students OR alumni OR campus OR hike OR cave)${REDDIT_NEG}`,
    );
    redditQueries.push(
      `${t} ("student newspaper" OR "campus paper" OR daily) (tradition OR lore OR ritual OR legend)${REDDIT_NEG}`,
    );
    redditQueries.push(
      `${t} (midnight OR solstice OR "full moon" OR dawn) (tradition OR swim OR hike OR gathering)${REDDIT_NEG}`,
    );
    redditQueries.push(`${t} (prank OR stunt OR streak OR dare OR hack) (campus OR students)${REDDIT_NEG}`);
    redditQueries.push(
      `${t} ("full moon" OR fountain OR naked OR streak) (campus tradition OR student)${REDDIT_NEG}`,
    );
  }

  const permalinkSet = new Set<string>();
  for (const q of redditQueries) {
    const paths = await redditSearchPermalinks(q, 14);
    for (const p of paths) permalinkSet.add(p);
    if (permalinkSet.size >= 36) break;
  }
  // Add targeted “top/all-time” subreddit searches when we can guess likely communities.
  const subreddits = guessSubreddits(location);
  for (const sr of subreddits) {
    const srQueries = [
      `${location} tradition OR \"before you graduate\" OR \"rite of passage\"${REDDIT_NEG}`,
      `${location} \"things to do\" \"before you leave\" OR \"you have to\"${REDDIT_NEG}`,
      `tradition OR ritual OR lore OR \"urban legend\" OR tunnel OR cave OR roof${REDDIT_NEG}`,
      `\"hidden\" OR \"secret\" OR \"locals\" OR \"unwritten\"${REDDIT_NEG}`,
    ];
    for (const q of srQueries) {
      const paths = await redditSubredditSearchPermalinks({
        subreddit: sr,
        query: q,
        limit: 12,
        sort: "top",
        t: "all",
      });
      for (const p of paths) permalinkSet.add(p);
      if (permalinkSet.size >= 60) break;
    }
    if (permalinkSet.size >= 60) break;
  }

  const permalinks = Array.from(permalinkSet).slice(0, 26);

  const redditBundlesRaw = (
    await Promise.all(permalinks.map((p) => fetchRedditThreadBundle(p)))
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));

  const ddgQueries: string[] = [];
  const looksAcademic = tokens.some((t) => /university|college|campus|institute|school/i.test(t));
  for (const t of tokens) {
    ddgQueries.push(
      `${t} "urban legend" OR folklore (forum OR blog OR tumblr) -tripadvisor -wikipedia${DDG_NEG}`,
    );
    ddgQueries.push(
      `${t} (student tradition OR "school lore" OR initiat*) (forum OR tumblr OR blogspot)${DDG_NEG}`,
    );
    ddgQueries.push(`${t} ("things they don't tell you" OR unwritten OR oral history) locals${DDG_NEG}`);
    ddgQueries.push(`${t} cave encyclopedia alumni OR "bring books" tradition${DDG_NEG}`);
    ddgQueries.push(`${t} (archive.org OR "web archive") student tradition OR campus${DDG_NEG}`);
    ddgQueries.push(
      `${t} ("student newspaper" OR "campus paper") tradition OR ritual OR legend${DDG_NEG}`,
    );
    ddgQueries.push(`${t} site:.edu folklore OR legend OR tradition OR ritual${DDG_NEG}`);
    ddgQueries.push(`${t} (hike OR ridge OR mountain OR reservoir) seniors alumni midnight${DDG_NEG}`);
    ddgQueries.push(`${t} (campus OR quad OR fountain) (prank OR stunt OR streak OR dare) students${DDG_NEG}`);
    ddgQueries.push(`${t} ("secret spot" OR "hidden gem" OR underground) students campus${DDG_NEG}`);
    if (looksAcademic) {
      ddgQueries.push(`${t} site:.edu inurl:news OR inurl:magazine tradition OR folklore${DDG_NEG}`);
    }
  }

  const ddgUrlSet = new Set<string>();
  for (const q of ddgQueries) {
    const urls = await duckLiteUrls(q, 9);
    for (const x of urls) ddgUrlSet.add(x);
    if (ddgUrlSet.size >= 40) break;
  }
  // Long boolean queries often return 0 from DDG lite; add short fallbacks to capture real URLs.
  if (ddgUrlSet.size < 6) {
    const shortBackfill: string[] = [];
    for (const t of tokens.slice(0, 4)) {
      shortBackfill.push(
        `${t} campus tradition`,
        `${t} school folklore`,
        `${t} "student" ritual`,
        `${t} alumni tradition ${looksAcademic ? "site:.edu" : "blog"}`,
      );
    }
    shortBackfill.push(`${location} local legend OR folklore${DDG_NEG}`);
    for (const q of shortBackfill) {
      if (ddgUrlSet.size >= 28) break;
      const urls = await duckLiteUrls(q, 12);
      for (const x of urls) ddgUrlSet.add(x);
    }
  }
  const ddgUrls = Array.from(ddgUrlSet).slice(0, 26);

  const webChunksRaw = (await Promise.all(ddgUrls.map((u) => safeFetchPage(u)))).filter(
    (x): x is NonNullable<typeof x> => Boolean(x),
  );

  const redditBundles = rankRedditBundles(redditBundlesRaw, needles, 14);
  const webChunks = rankWebChunks(webChunksRaw, needles, 14);

  const sources: string[] = [];
  for (const b of redditBundles) sources.push(b.url);
  for (const w of webChunks) sources.push(w.url);

  const parts: string[] = [];
  parts.push(`PLACE QUERY: ${location}`);
  if (geo) {
    parts.push(`GEOCODER (approximate): ${geo.name} @ ${geo.lat}, ${geo.lng}`);
  }
  parts.push("");
  parts.push(
    "GROUNDING: Below are numbered SOURCE CHUNKS. You may ONLY assert specific facts, place names, objects, times, and",
  );
  parts.push(
    "procedures that literally appear inside a chunk. If only one obscure article mentions a ritual, stick to that wording.",
  );
  parts.push("Do not invent secret societies, generic basement meetings, or 'cryptic symbols' unless those words appear.");
  parts.push("");

  let sourceIdx = 1;
  for (const b of redditBundles) {
    parts.push(`\n[SOURCE ${sourceIdx++}] REDDIT ${b.url}\n${b.text}`);
  }
  for (const w of webChunks) {
    parts.push(`\n[SOURCE ${sourceIdx++}] WEB ${w.url}\nTITLE: ${w.title}\n${w.text}`);
  }

  let text = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const max = 24_000;
  if (text.length > max) {
    text = `${text.slice(0, max)}\n\n[truncated]`;
  }

  const pageTitle = `Location: ${location} (underground-biased corpus)`;

  const debug: GatherDebug = {
    redditThreads: redditBundles.length,
    webPages: webChunks.length,
    charCount: text.length,
  };

  return { pageTitle, text, sources: dedupeUrls(sources), geo, debug };
}
