import { randomBytes } from "crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const UA = "WanderBot/0.1 (+https://github.com/GunmetalPoem/wander) ferret; educational - contact if problematic";

function ferretBinary(): string {
  return (process.env.FERRET_PATH ?? "ferret").trim() || "ferret";
}

function cdpFromEnv(): boolean {
  const v = process.env.LORE_FERRET_CDP ?? process.env.LORE_FERRET_BROWSER;
  return v === "1" || v === "true" || v === "yes";
}

function timeoutMs(): number {
  const n = Number(process.env.LORE_FERRET_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

function fqlForUrl(u: string, cdp: boolean): string {
  const urlLit = JSON.stringify(u);
  if (cdp) {
    // JS-heavy / SPA: Chrome via CDP (requires Chrome/Chromium available to the CLI)
    return `
LET page = DOCUMENT(${urlLit}, { driver: "cdp", userAgent: ${JSON.stringify(UA)}, timeout: ${timeoutMs()} })
LET t = ELEMENT(page, "title")
LET b = ELEMENT(page, "body")
LET title = t != NONE ? t.innerText : ""
LET text = b != NONE ? b.innerText : (page.innerText)
RETURN { title, text }
`.trim();
  }
  // Fast path: static HTML over HTTP
  return `
LET page = DOCUMENT(${urlLit}, { userAgent: ${JSON.stringify(UA)} })
LET t = ELEMENT(page, "title")
LET b = ELEMENT(page, "body")
LET title = t != NONE ? t.innerText : ""
LET text = b != NONE ? b.innerText : (page.innerText)
RETURN { title, text }
`.trim();
}

type FerretResultRow = { title?: unknown; text?: unknown };

function parseFerretJson(stdout: string): FerretResultRow {
  const raw = stdout.trim();
  if (!raw) {
    throw new Error("Ferret returned empty output");
  }
  const j = JSON.parse(raw) as unknown;
  if (Array.isArray(j) && j.length > 0 && typeof j[0] === "object" && j[0] !== null) {
    return j[0] as FerretResultRow;
  }
  if (j && typeof j === "object") {
    return j as FerretResultRow;
  }
  throw new Error("Ferret JSON was not a recognized shape");
}

function asStr(v: unknown, fallback: string) {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

/**
 * Scrape a page with MontFerret (requires `ferret` CLI in PATH, or FERRET_PATH set).
 * https://github.com/MontFerret/cli
 */
export async function fetchPageTextWithFerret(
  url: string,
  opts?: { cdp?: boolean; maxTextChars?: number },
): Promise<{ title: string; text: string }> {
  const cdp = opts?.cdp ?? cdpFromEnv();
  const fql = fqlForUrl(url, cdp);
  const tmp = path.join(os.tmpdir(), `lore-ferret-${Date.now()}-${randomBytes(6).toString("hex")}.fql`);
  await fs.writeFile(tmp, fql, "utf8");

  const bin = ferretBinary();
  const args = ["run"];
  if (cdp) args.push("--browser-headless");
  args.push("--log-level", "error", "-a", UA, tmp);

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: Math.min(180_000, timeoutMs() + 60_000),
      maxBuffer: 12 * 1024 * 1024,
    });
    if (stderr) {
      const s = stderr.trim();
      if (s && s.length < 2000 && process.env.NODE_ENV === "development") {
        console.warn("[ferret] stderr:", s);
      }
    }
    const row = parseFerretJson(stdout);
    const title = asStr(row.title, url).slice(0, 200);
    let text = asStr(row.text, "").replace(/\s+/g, " ").trim();
    const max = opts?.maxTextChars ?? 14_000;
    if (text.length > max) {
      text = `${text.slice(0, max)} [truncated]`;
    }
    if (text.length < 80) {
      throw new Error("Ferret returned very little text; try LORE_FERRET_CDP=1 for JS-heavy pages");
    }
    return { title, text };
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

export async function ferretCliVersion(): Promise<string | null> {
  try {
    const bin = ferretBinary();
    const { stdout } = await execFileAsync(bin, ["version"], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
