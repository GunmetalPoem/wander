import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as cheerio from "cheerio";
import { fetchPageTextWithFerret } from "@/lib/ferret-scrape";

const execFileAsync = promisify(execFile);

function parseLastJsonLine(
  stdout: string,
): { ok: boolean; title?: string; text?: string; error?: string } {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as { ok: boolean; title?: string; text?: string; error?: string };
    } catch {
      // continue
    }
  }
  throw new Error("Scrapy output had no valid JSON line");
}

async function fetchPageTextWithScrapy(
  url: string,
  maxTextChars: number,
): Promise<{ title: string; text: string }> {
  const root = process.cwd();
  const script = process.env.LORE_SCRAPY_SCRIPT
    ? path.resolve(process.env.LORE_SCRAPY_SCRIPT)
    : path.join(root, "tools/scrapy-fetch/fetch_one.py");
  const isWin = process.platform === "win32";
  const usePyLauncher = isWin && !process.env.LORE_PYTHON;
  const bin = process.env.LORE_PYTHON ?? (isWin ? "py" : "python3");
  const args = usePyLauncher
    ? ["-3", script, url, String(maxTextChars)]
    : [script, url, String(maxTextChars)];

  const { stdout } = await execFileAsync(
    bin,
    args,
    { maxBuffer: 4_000_000, timeout: 60_000, env: { ...process.env, PYTHONUNBUFFERED: "1" } },
  );
  const j = parseLastJsonLine(String(stdout));
  if (!j.ok) {
    throw new Error(j.error || "Scrapy fetch failed");
  }
  const title = (j.title ?? url).slice(0, 200);
  const text = (j.text ?? "").trim();
  if (text.length < 8) {
    throw new Error("Scrapy returned almost no text");
  }
  return { title, text };
}

function pickRoot($: cheerio.CheerioAPI) {
  const main = $("main").first();
  if (main.length) return main;
  const article = $("article").first();
  if (article.length) return article;
  return $("body");
}

export async function fetchPageText(
  url: string,
  opts?: { maxTextChars?: number; ferret?: boolean; ferretCdp?: boolean; scrapy?: boolean },
): Promise<{ title: string; text: string }> {
  const max = opts?.maxTextChars ?? 14_000;
  const useFerret = opts?.ferret ?? /^(1|true|yes)$/i.test(process.env.LORE_USE_FERRET ?? "");
  const useScrapy = opts?.scrapy ?? /^(1|true|yes)$/i.test(process.env.LORE_USE_SCRAPY ?? "");
  if (useFerret) {
    try {
      return await fetchPageTextWithFerret(url, {
        maxTextChars: max,
        cdp: opts?.ferretCdp ?? /^(1|true|yes)$/i.test(process.env.LORE_FERRET_CDP ?? ""),
      });
    } catch {
      // fall back to static fetch below
    }
  }
  if (useScrapy) {
    try {
      return await fetchPageTextWithScrapy(url, max);
    } catch {
      // fall back to static fetch (node fetch + cheerio) below
    }
  }

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "LoreBot/0.1 (+https://github.com) research scraper; educational project - contact site owner if problematic",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  $("script, style, noscript, svg").remove();

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const h1 = $("h1").first().text().trim();
  const docTitle = $("title").first().text().trim();
  const title = (ogTitle || h1 || docTitle || url).slice(0, 200);

  const root = pickRoot($);
  const text = root.text().replace(/\s+/g, " ").trim();

  const clipped = text.length > max ? `${text.slice(0, max)} [truncated]` : text;

  return { title, text: clipped };
}
