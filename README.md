# Wanderday + Lore (prototype)

## Trip planner (`/`)

The home page is a **Wanderday**-style trip planner: fill the form (city, days, budget, vibes, pace), click **Generate trip** (requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), or **Load SF demo** for a hardcoded San Francisco day without AI. The map uses **Mapbox GL** with the **Standard** style and 3D tilt; set your **default public token** as `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env` (from [Mapbox](https://account.mapbox.com/)). `POST /api/trip/directions` and `GET /api/trip/nearby` use the same token when it is set (Directions + Geocoding); without a token they fall back to **OSRM** and **Photon** so routing still works. Drag stops in the **timeline** to reorder (route refetches).

Optional: set `MAPBOX_ACCESS_TOKEN` for server-only geocoding/routing; otherwise the public token is used.

The legacy **Lore** quest feed lives at [`/lore`](http://localhost:3000/lore). Lab is still at [`/admin`](http://localhost:3000/admin).

---

## Lore (older flow)

Public quest feed plus an internal **Lab** (`/admin`) where you type a **place name**. The server builds an **underground-biased corpus**: many targeted **Reddit** searches, then full thread JSON (post + nested comments), plus **DuckDuckGo** (Lite + HTML fallback) for long-tail forum/blog links with a **blocklist** for travel-broker and encyclopedic sites (Wikipedia, TripAdvisor-style domains, etc.). **Open-Meteo** geocoding (no key) anchors the place. An OpenAI model drafts structured quests with instructions to favor oral tradition / hyperlocal lore over generic tourism. **Advanced → single URL** still does one-page scrape.

There are **no logins or profiles** in this branch — suitable for a static-feeling demo site.

## Troubleshooting: “tons of” TypeScript / IDE errors

1. **Use the workspace TypeScript**  
   In the command palette: “TypeScript: Select TypeScript Version” → **Use Workspace Version** (see `.vscode/settings.json`).

2. **Duplicate files in `node_modules`** (common on macOS)  
   If you see paths like `client.d 2.ts` or `index 2.js` under `node_modules/.prisma`, Finder/iCloud may have duplicated files and the language service can report hundreds of bogus errors. Fix:
   ```bash
   rm -rf node_modules .next
   npm install
   npx prisma generate
   ```

3. **`Module not found` / 500 on `/` in dev (Turbopack)**  
   The trip planner uses **Mapbox GL** + `react-map-gl`. **Turbopack** (`next dev --turbo`) does not fully resolve `mapbox-gl` in dev (seen on Next 14 and 15), which produces `https://nextjs.org/docs/messages/module-not-found` and a 500. **Fix:** use the default dev server only — `npm run dev` (no `--turbo`). Production `npm run build` is unaffected.

4. **`npm warn Unknown env config "devdir"`**  
   That comes from a global npm config on your machine, not this repo. It is safe to ignore, or remove/ fix the `devdir` entry in `~/.npmrc`.

## Requirements

- Node 20+
- An [OpenAI](https://platform.openai.com/) API key for scrape → parse (set `OPENAI_API_KEY`)

## Setup

```bash
cp .env.example .env
# Edit .env: add OPENAI_API_KEY (and optional ADMIN_SECRET)

npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open `http://localhost:3000` for the trip planner, `http://localhost:3000/lore` for the quest feed, and `http://localhost:3000/admin` for Lab.

## Hot reload (no restarts)

- **Mapbox on the home page:** run **`npm run dev`** (Webpack). **Do not** use `npm run dev:turbo` for this app — Turbopack breaks `mapbox-gl` in dev (module-not-found on `/`). Production `next build` / `next start` is fine.
- **If changes don’t show up** (rare watcher issues), use `npm run dev:poll` (file polling).
- **Note**: `npm run build && npm run start` is production mode and won’t hot-reload.

## Optional: MontFerret / Ferret (CLI) scraping

Lore’s default `fetch` + HTML parsing is fast but can fail on very JS-heavy pages. You can install the
official Ferret CLI ([MontFerret/ferret](https://github.com/MontFerret/ferret) / [MontFerret/cli](https://github.com/MontFerret/cli))
and enable it in `.env`:

- `LORE_USE_FERRET=1` — try Ferret for page text (falls back to the built-in fetcher if the CLI is missing)
- `LORE_FERRET_CDP=1` — use headless Chrome via CDP (slower, best for SPAs; requires a local Chrome/Chromium)
- `FERRET_PATH` — path to the `ferret` binary if it is not on `PATH`

**Install the CLI (pick one; no Go required for binaries):**

1. **Prebuilt (recommended):** from [Releases](https://github.com/MontFerret/cli/releases) download
   `cli_darwin_arm64.tar.gz` (Apple Silicon) or `cli_darwin_x86_64.tar.gz` (Intel), extract the `ferret` binary, then set `FERRET_PATH` in `.env`.

2. **Go, pinned stable (avoids v2 alpha / module mismatch):** do **not** use `.../cli/v2/ferret@latest` if you get compile errors. Use a **released v1.11.x** tag:

```bash
go install github.com/MontFerret/cli/ferret@v1.11.1
```

Ensure `$(go env GOPATH)/bin` is on your `PATH` (e.g. `export PATH="$PATH:$(go env GOPATH)/bin"`).

3. **If `go install` still fails** with `runtime.NewTypeFor` / “too many arguments”: you have mixed **v2/alpha** deps — use the prebuilt release binary instead, or only install a **tagged** release, not `@latest` on a `v2` path.

## Optional: Scrapy (Python) for HTTP fetches

Some sites respond better to [Scrapy’s](https://github.com/scrapy/scrapy) downloader (redirects, retries, `User-Agent`) than to Node’s `fetch`. Install the helper env and dependencies:

```bash
python3 -m pip install -r tools/scrapy-fetch/requirements.txt
```

On macOS, `pip` alone is often not on your `PATH`; `python3 -m pip` always uses the right pip for that interpreter.

In `.env`:

- `LORE_USE_SCRAPY=1` — run `tools/scrapy-fetch/fetch_one.py` (single-page fetch used by **Advanced URL** and by DuckDuckGo passes in **Discovery**). If Python/Scrapy is missing, Lore falls back to the built-in `fetch` + Cheerio path.
- `LORE_SCRAPY_SCRIPT` — override path to `fetch_one.py` if you moved it
- `LORE_PYTHON` — e.g. `python3.12` or a full path (on Windows, if unset, `py -3` is used)

**Note:** Scrapy requires a local Python. Serverless hosts (e.g. Vercel) often cannot run this subprocess; use it on a machine or container where `python3` and Scrapy are installed.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file (default in `.env.example`) |
| `OPENAI_API_KEY` | Required for `/api/scrape` |
| `OPENAI_MODEL` | Optional override (default `gpt-4o-mini`) |
| `ADMIN_SECRET` | If set, `POST /api/scrape` and `POST /api/quests/publish` require header `x-admin-secret` |
| `LORE_USE_SCRAPY` | If `1` / `true` / `yes`, try [Scrapy](https://github.com/scrapy/scrapy) for page text before plain `fetch` (requires Python + `tools/scrapy-fetch` deps) |
| `LORE_SCRAPY_SCRIPT` | Path to `fetch_one.py` (optional) |
| `LORE_PYTHON` | Python executable for Scrapy (optional; default `python3`, or `py -3` on Windows) |
| `LORE_SKIP_QUEST_RECOVERY` | If set, only the **strict** model pass runs (no relaxed second pass or curation stub) |
| `LORE_NO_QUEST_STUB` | If set, no **curation draft** quest when both passes return empty (relaxed pass still runs for large corpora) |

### Quest compile (when the strict parser returns no quests)

If the first model pass returns `{"quests":[]}` but the gathered text is long enough (thousands of characters from Reddit + web), Lore automatically:

1. **Relaxed pass** — second request with instructions to allow weaker / more tangential campus material, still grounded in `[SOURCE n]` blocks.
2. **Curation draft** — if both passes are still empty and the corpus is very large (5k+ characters), a low-confidence **draft** quest is created so you can title and copy-edit from the saved RawScrape in the lab (not invented lore—explicitly a template to replace).

## AI use (course policy)

This repository was scaffolded and iterated with **Cursor / coding agents**. Location gather uses **Reddit** (search + thread bodies/comments), **DuckDuckGo** HTML link discovery, host blocklists, and **Open-Meteo** geocoding (`src/lib/location-corpus.ts`). Runtime categorization uses the **OpenAI API** from `src/lib/parse-quest.ts` with **numbered `[SOURCE n]` chunks**, a required `sourcesSay` grounding block merged into the saved description, strict “no invented societies” rules, and lower temperature. Ultra-rare single articles may still miss search indexes; for those, use **Lab → Advanced → paste the exact URL** so the page becomes `[SOURCE 1]`. Seeded quest copy in `prisma/seed.mjs` is hand-written placeholder lore for layout demos — not model output. Third-party sites may rate-limit or block automated requests from some networks.

## Notes

- Many modern sites block simple server-side fetches or need JavaScript; if scrape returns very little text, try Wikipedia, blogs, or static pages.
- Quest text is **not** legal or safety advice. The app surfaces model-extracted summaries; you are responsible for real-world compliance.
