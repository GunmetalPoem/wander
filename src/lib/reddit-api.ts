/** Minimal Reddit OAuth client-credentials wrapper (read-only). */
const UA =
  "Wander/0.1 (+https://github.com/GunmetalPoem/wander) reddit client; educational project - contact if problematic";

type TokenCache = { token: string; expiresAtMs: number } | null;
let cache: TokenCache = null;

function env() {
  const id = process.env.REDDIT_CLIENT_ID?.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim();
  return { id, secret };
}

function hasCreds() {
  const { id, secret } = env();
  return Boolean(id && secret);
}

async function getAccessToken(): Promise<string> {
  if (!hasCreds()) {
    throw new Error("Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET");
  }
  const { id, secret } = env();
  const now = Date.now();
  if (cache && cache.expiresAtMs - now > 60_000) return cache.token;

  const basic = Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      accept: "application/json",
    },
    body: "grant_type=client_credentials",
    // Avoid Next caching; tokens should be fresh.
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Reddit token error HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  const j = (await res.json()) as { access_token: string; expires_in: number };
  const token = j.access_token;
  const expiresIn = Number(j.expires_in);
  cache = { token, expiresAtMs: now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 };
  return token;
}

async function oauthFetch(url: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": UA,
      accept: "application/json",
    },
    next: { revalidate: 0 },
  });
}

export async function redditSearchPermalinksOAuth(params: {
  query: string;
  limit: number;
}): Promise<string[]> {
  const u = new URL("https://oauth.reddit.com/search");
  u.searchParams.set("q", params.query);
  u.searchParams.set("limit", String(Math.min(25, Math.max(params.limit, 10))));
  u.searchParams.set("sort", "relevance");
  u.searchParams.set("type", "link");
  u.searchParams.set("raw_json", "1");

  const res = await oauthFetch(u.toString());
  if (!res.ok) return [];
  const j = (await res.json()) as {
    data?: { children?: { data?: { permalink?: string } }[] };
  };
  const out: string[] = [];
  for (const c of j.data?.children ?? []) {
    const p = c.data?.permalink;
    if (typeof p === "string" && p.includes("/comments/")) out.push(p);
  }
  return out;
}

export async function redditSubredditSearchPermalinksOAuth(params: {
  subreddit: string;
  query: string;
  limit: number;
  sort?: "top" | "relevance" | "new" | "comments";
  t?: "all" | "year" | "month";
}): Promise<string[]> {
  const u = new URL(`https://oauth.reddit.com/r/${params.subreddit}/search`);
  u.searchParams.set("q", params.query);
  u.searchParams.set("restrict_sr", "1");
  u.searchParams.set("include_over_18", "on");
  u.searchParams.set("limit", String(Math.min(25, Math.max(params.limit, 10))));
  u.searchParams.set("sort", params.sort ?? "top");
  u.searchParams.set("t", params.t ?? "all");
  u.searchParams.set("type", "link");
  u.searchParams.set("raw_json", "1");

  const res = await oauthFetch(u.toString());
  if (!res.ok) return [];
  const j = (await res.json()) as {
    data?: { children?: { data?: { permalink?: string } }[] };
  };
  const out: string[] = [];
  for (const c of j.data?.children ?? []) {
    const p = c.data?.permalink;
    if (typeof p === "string" && p.includes("/comments/")) out.push(p);
  }
  return out;
}

export async function redditThreadJsonOAuth(pathname: string): Promise<unknown | null> {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const clean = path.replace(/\/$/, "");
  const u = new URL(`https://oauth.reddit.com${clean}`);
  u.searchParams.set("raw_json", "1");
  u.searchParams.set("depth", "3");
  u.searchParams.set("limit", "80");
  u.searchParams.set("sort", "top");

  const res = await oauthFetch(u.toString());
  if (!res.ok) return null;
  return (await res.json()) as unknown;
}

export function redditOAuthEnabled() {
  return hasCreds();
}

