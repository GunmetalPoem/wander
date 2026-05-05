# Wander

**Wander** is a Next.js app with an AI **trip planner** on `/` (Wanderday-style).

Set city (with disambiguation when several places share a name), days, budget, vibes, and pace. **Generate trip** needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or use **Load SF demo** for a hardcoded day without AI. The map uses **Mapbox GL** (Standard style, 3D tilt); set `NEXT_PUBLIC_MAPBOX_TOKEN` from [Mapbox](https://account.mapbox.com/). Stops are geocoded with **Google Places** (when `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` is set) and/or **Mapbox**; the server can bias search to the city you confirm in the form. `POST /api/trip/directions` and `GET /api/trip/nearby` use your tokens when set; without Mapbox, routing can fall back to **OSRM** / **Photon**. Drag stops in the **timeline** to reorder.

Optional: `MAPBOX_ACCESS_TOKEN` for server-only use; `GOOGLE_*` for place resolution.

## Troubleshooting: TypeScript / IDE errors

1. **Workspace TypeScript** — Command palette: “TypeScript: Select TypeScript Version” → **Use Workspace Version** (see `.vscode/settings.json`).
2. **Duplicate files in `node_modules`** — If you see `client 2.ts` under `node_modules/.prisma`, remove `node_modules` and `.next`, then `npm install` and `npx prisma generate`.
3. **`Module not found` / 500 on `/` with Turbopack** — The trip planner uses **Mapbox GL** + `react-map-gl`. **Turbopack** (`next dev --turbo`) often fails to resolve `mapbox-gl` in dev. Use **`npm run dev`** (no `--turbo`). Production `next build` is fine.
4. **`npm warn Unknown env config "devdir"`** — From your global npm config; safe to ignore or fix `~/.npmrc`.

## Requirements

- Node 20+
- At least one of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for trip generation (see `.env.example`)

## Setup

```bash
cp .env.example .env
# Add keys from .env.example

npm install
npx prisma db push   # optional if you use prisma/seed for local data
npm run dev
```

Open `http://localhost:3000`.

## Hot reload

- **Mapbox on `/`:** use **`npm run dev`** (Webpack), not `dev:turbo`.
- **Watcher issues:** `npm run dev:poll`.
- Production: `npm run build && npm start` (no HMR).

## Optional: MontFerret (CLI) for page fetches

Trip **stop details** can fetch venue pages with optional [Ferret CLI](https://github.com/MontFerret/cli) for JS-heavy sites. See `.env.example` for `LORE_USE_FERRET`, `LORE_FERRET_CDP`, `FERRET_PATH`.

## Optional: Scrapy (Python)

For heavier HTML extraction when fetching pages (stop details path), see `LORE_USE_SCRAPY` and related vars in `.env.example`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite (Prisma); optional for local seeds |
| `OPENAI_API_KEY` | Trip chat/plan if Anthropic unset; stop-details parsing |
| `ANTHROPIC_API_KEY` | Optional primary trip generation |
| `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` | Server place search & city confirmation |
| `NEXT_PUBLIC_MAPBOX_TOKEN` / `MAPBOX_ACCESS_TOKEN` | Map + geocoding + directions |
