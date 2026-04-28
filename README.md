# Wander

**Wander** is a Next.js app: a **3D trip planner** on `/` (Wanderday-style) and a **quest discovery** flow with a public feed at [`/lore`](http://localhost:3000/lore) and an internal **Lab** at [`/admin`](http://localhost:3000/admin).

## Trip planner (`/`)

Set city (with disambiguation when several places share a name), days, budget, vibes, and pace. **Generate trip** needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or use **Load SF demo** for a hardcoded day without AI. The map uses **Mapbox GL** (Standard style, 3D tilt); set `NEXT_PUBLIC_MAPBOX_TOKEN` from [Mapbox](https://account.mapbox.com/). Stops are geocoded with **Google Places** (when `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` is set) and/or **Mapbox**; the server can bias search to the city you confirm in the form. `POST /api/trip/directions` and `GET /api/trip/nearby` use your tokens when set; without Mapbox, routing can fall back to **OSRM** / **Photon**. Drag stops in the **timeline** to reorder.

Optional: `MAPBOX_ACCESS_TOKEN` for server-only use; `GOOGLE_*` for place resolution.

## Quest feed & Lab (older flow)

The server builds an **underground-biased corpus**: targeted **Reddit** searches, full thread JSON, **DuckDuckGo** (Lite + HTML) for forum/blog links, with a **blocklist** for travel-broker and encyclopedic sites. **Open-Meteo** geocoding (no key) anchors the place. An OpenAI model drafts structured quests favoring oral tradition and hyperlocal stories over generic tourism. **Advanced → single URL** scrapes one page.

There are **no logins or profiles** in this branch — good for a static demo.

## Troubleshooting: TypeScript / IDE errors

1. **Workspace TypeScript** — Command palette: “TypeScript: Select TypeScript Version” → **Use Workspace Version** (see `.vscode/settings.json`).
2. **Duplicate files in `node_modules`** — If you see `client 2.ts` under `node_modules/.prisma`, remove `node_modules` and `.next`, then `npm install` and `npx prisma generate`.
3. **`Module not found` / 500 on `/` with Turbopack** — The trip planner uses **Mapbox GL** + `react-map-gl`. **Turbopack** (`next dev --turbo`) often fails to resolve `mapbox-gl` in dev. Use **`npm run dev`** (no `--turbo`). Production `next build` is fine.
4. **`npm warn Unknown env config "devdir"`** — From your global npm config; safe to ignore or fix `~/.npmrc`.

## Requirements

- Node 20+
- `OPENAI_API_KEY` for scrape → parse (and optional trip AI provider)

## Setup

```bash
cp .env.example .env
# Add OPENAI_API_KEY, optional keys from .env.example

npm install
npx prisma db push
npm run db:seed
npm run dev
```

- `http://localhost:3000` — trip planner  
- `http://localhost:3000/lore` — quest feed  
- `http://localhost:3000/admin` — Lab  

## Hot reload

- **Mapbox on `/`:** use **`npm run dev`** (Webpack), not `dev:turbo`.
- **Watcher issues:** `npm run dev:poll`.
- Production: `npm run build && npm start` (no HMR).

## Optional: MontFerret (CLI) scraping

Default `fetch` + HTML parsing is fast; very JS-heavy pages may need the [Ferret CLI](https://github.com/MontFerret/cli). See `.env.example` for `LORE_USE_FERRET`, `LORE_FERRET_CDP`, `FERRET_PATH` (historical `LORE_` prefix in env names).

## Optional: Scrapy (Python)

```bash
python3 -m pip install -r tools/scrapy-fetch/requirements.txt
```

Enable with `LORE_USE_SCRAPY=1` and related vars in `.env` (see **Environment** below). If Scrapy is missing, the app falls back to Node `fetch` + Cheerio. Serverless hosts may not run Python subprocesses.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file (default in `.env.example`) |
| `OPENAI_API_KEY` | Scrape/parse; optional for trip if Anthropic is set |
| `ANTHROPIC_API_KEY` | Optional trip generation |
| `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` | Server place search & city confirmation |
| `NEXT_PUBLIC_MAPBOX_TOKEN` / `MAPBOX_ACCESS_TOKEN` | Map + geocoding |
| `ADMIN_SECRET` | If set, some admin routes need `x-admin-secret` |
| `LORE_USE_SCRAPY`, `LORE_SCRAPY_SCRIPT`, `LORE_PYTHON` | Scrapy integration (env names kept for compatibility) |
| `LORE_SKIP_QUEST_RECOVERY`, `LORE_NO_QUEST_STUB` | Quest pipeline tuning |

### Quest compile (strict parser returns no quests)

If the first pass returns `{"quests":[]}` but the corpus is large, the app may run a **relaxed** second pass and, in edge cases, a **curation draft** for manual editing in the Lab.

## AI use (course / policy)

This repository was built with help from **Cursor / coding agents**. Location gather uses **Reddit**, **DuckDuckGo**, blocklists, and **Open-Meteo** geocoding. Quest parsing uses the **OpenAI API** with `[SOURCE n]` grounding. Seeded data in `prisma/seed.mjs` is placeholder copy for layout — not model output.

## Notes

- Many sites block simple fetches; try static pages or **Lab → Advanced → URL** for one page = one source.
- Quest text is not legal or safety advice; verify in the real world.
