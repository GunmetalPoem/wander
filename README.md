# Wander — an AI trip planner that plans *together*

Wander is a full-stack web app that turns a few preferences ("3 days in Lisbon, foodie + history, relaxed pace, wheelchair-friendly") into a **geographically coherent, day-by-day itinerary on an interactive 3D map** — and lets a whole group co-plan one trip from a single shareable link.

It is built with Next.js 15, TypeScript, Mapbox GL, and Prisma, and uses Claude / GPT to generate itineraries that are then geocoded, route-optimized, weather-checked, and enriched with real venue details.

> **Try it in 60 seconds, no API keys:** run the app and click **Load SF demo** on the home page for a fully rendered San Francisco day on the map. Add an API key to generate live trips for any city.

---

## 1. Problem & insight

**The problem.** Trip planning has two painful modes. Solo, you bounce between a chatbot that spits out a generic bullet list, Google Maps to check if any of it is near anything else, a weather app, and ten review tabs. In a group, it's worse: everyone has different budgets, diets, energy levels, and "must-sees," and someone ends up manually reconciling a group chat into one plan that inevitably disappoints half the table.

**The insight.** A raw LLM itinerary is *unstructured travel advice*, not a *plan*. Three things separate the two, and none of them are things the language model is good at on its own:

1. **Geography.** LLMs happily route you "east → west → east again." A real day is a continuous thread through one or two neighborhoods. That's a routing problem, not a text problem.
2. **Timing.** Lunch belongs at lunch, museums get 90 minutes, and you shouldn't sprint 40 minutes between every stop. This needs explicit duration/daypart reasoning and verification.
3. **Group preference reconciliation.** One itinerary has to satisfy several people. That's a merge problem over structured preferences, not a single prompt.

**Wander's approach** is to use the LLM only for what it's good at (knowing real, interesting places and describing them well) and to handle the rest deterministically: a custom routing pass shortens each day's path, a meal/daypart model keeps the timeline sane, and a per-participant preference model merges a group into one coherent draft. The result is meant to feel less like "here's a list" and more like "here's a plan you could actually walk tomorrow."

---

## 2. What's built (execution & technical work)

Wander is a substantial, working application — **~9,900 lines of TypeScript/TSX** across a Next.js App Router frontend, 12 API routes, and a Prisma/SQLite data layer. Two complete product surfaces:

### Solo planner (`/`)
- **Chat-first planning UI** with a live form (city, days, budget $/day, group size, vibes, pace, transport, trip date, accessibility) and a conversational panel that edits the form for you.
- **City disambiguation** — when "Springfield" or "SF" is ambiguous, the server offers candidates and biases all downstream search to the city you confirm.
- **Streaming, day-by-day itinerary build (NDJSON).** Days appear on the map as they're generated rather than after a 30-second wait. Each day is then geocoded and enriched independently, with events (`day` → `stops_located` → `stops_enriched` → `weather` → `complete`) streamed to the client.
- **Interactive 3D Mapbox map** with per-day routes, plus a **drag-to-reorder timeline** (`@dnd-kit`).
- **Deep stop details** fetched on demand (hours, price, why-go), with optional headless-browser scraping for JS-heavy venue pages.
- **Accessibility-aware planning** (wheelchair routing, low-walking clustering, frequent rest stops) baked into the prompt.

### Group trip rooms (`/trip/room/[id]`)
- **One shareable link** creates a room. Each participant gets their **own preference column and their own AI assistant** that captures *only that person's* wishes.
- **Per-participant preferences are merged** into a single "unified draft," and the group builds one itinerary from it — with a build lock so two people can't kick off conflicting builds.
- **Async AI processing**: messages are queued and processed server-side (`aiProcessingAt` / `aiProcessedAt` columns), so the room stays responsive and survives refreshes.
- **Shared map view** everyone sees update as the plan is built.

### The engineering underneath
- **Custom JSON-Lines streaming parser** (`trip-plan-service.ts`) that extracts complete top-level JSON objects from a token stream using brace-depth tracking with string/escape awareness — so whitespace inside descriptions never splits an object early. Includes a fallback that recovers a plan if the model pretty-prints or wraps everything in an envelope.
- **Deterministic route optimizer** (`trip-optimize.ts`): groups stops into time-of-day buckets (with meal-stop nudges so lunch isn't routed before the morning sights), does greedy nearest-neighbor from the city center within each bucket, then runs **2-opt segment reversal** to shorten the open path — all while keeping the timeline non-decreasing.
- **Multi-provider geocoding** (Google Places → Mapbox) with **OSRM** routing and **Photon** geocoding as keyless fallbacks, and concurrency-limited batch geocoding.
- **Strict schema validation** (Zod) at every boundary, with graceful degradation: a failed day is dropped with a warning instead of crashing the trip.
- **Provider abstraction**: Anthropic Claude is primary, OpenAI is an automatic fallback; both share one streaming interface.

### Evidence of iteration
The commit history shows the project finding its shape: it started broader (a "quest feed" and "lab" that were **deliberately cut** to focus the product), was rebranded to Wander, then grew numeric budgets / accessibility / weather, then group rooms, then the chat-first redesign, and finally day-by-day streaming. Scope was narrowed on purpose, not by accident — see `git log`.

---

## 3. Evaluation & evidence

This is a product, so it's evaluated the way a product is — by whether the output is correct, usable, and better than the naive baseline. The validation is mostly qualitative and is described honestly below.

### Quantitative benchmark: the route optimizer (`npm run eval`)

The core technical claim — *"Wander turns a raw LLM place-list into a route you could actually walk"* — is measured directly. `tools/eval/route-optimizer-eval.ts` feeds the optimizer realistic days (real venue coordinates for **5 cities**, authored in the zig-zag order a raw model typically emits) and measures straight-line path length before vs. after, using an **independent** haversine so the measurement doesn't just echo the implementation. It's fully deterministic — no API keys or network. Full report: [`docs/eval-results.md`](docs/eval-results.md).

**Results:**

| Metric | Result |
| --- | --- |
| Total path distance | **169.1 km → 119.0 km (−29.6%)** |
| Mean reduction per day | **22.4%** |
| Days improved | 5 / 6 (best: NYC −45.3%, Tokyo −37.5%) |
| Invariant — optimizer never lengthens a day | ✅ PASS |
| Invariant — never reorders a later daypart before an earlier one | ✅ PASS |

**This benchmark drove a real fix.** Its first run *failed* the "never lengthens a day" invariant — one day (Paris d2) came out **2% longer**, because greedy nearest-neighbor plus bucket-constrained 2-opt can, on some geometries, beat itself. That falsified an earlier assumption that the optimizer was non-worsening by construction. The fix (`trip-optimize.ts`): fall back to the original ordering whenever it was already time-valid and shorter. After the fix, both invariants pass and the regression is gone (0.0%). This is exactly the kind of thing evaluation is supposed to catch.

**Other validation built into the system:**
- **Schema-level correctness.** Every model response is parsed and validated against a Zod schema twice (per-day fragment and final assembled plan). Malformed days are discarded with a named warning (`day_N_invalid`) rather than rendered.
- **Layered fallbacks as a robustness test.** The streaming parser falls back to whole-envelope parsing; geocoding falls back Google → Mapbox → Photon; routing falls back to OSRM. Each fallback path is exercised by simply running without the corresponding key.

**How it was tested manually:**
- **Across many cities and shapes** (well-known and ambiguous city names, 1–7 day trips, walking vs. driving, packed vs. relaxed, accessibility on/off) to check that routes stay in-neighborhood, meals land at meal times, and stops resolve to real coordinates.
- **Demo as a reproducibility check.** The "Load SF demo" path renders a known-good plan without any external calls, so the rendering/map pipeline can be verified independently of the model.

**User research.** [`docs/user-research.md`](docs/user-research.md) holds the target personas, design hypotheses, and a ready-to-run interview guide that shaped the build. Note it honestly: that document contains design reasoning and *anticipated* feedback, **not** transcripts of conducted interviews — a formal user study has not been run yet, and the doc is explicit about which decisions were real (tied to git history) versus projected.

**Known limitations & failure analysis (honest):**
- No unit/integration test suite yet. There is an automated, deterministic **benchmark** for the optimizer (`npm run eval`) and runtime schema validation, but the rest is validated manually. Broadening automated coverage is the biggest remaining gap.
- Itinerary *quality* (are these genuinely the best places?) depends on the LLM and is not independently benchmarked against expert-curated guides.
- Geocoding can occasionally resolve a chain to the wrong branch; the prompt asks for the closest branch but this isn't verified post-hoc.
- The optimizer guarantees shorter *straight-line* paths, not shorter real travel time, and time-of-day ordering uses heuristics (keyword meal detection) that can misclassify edge cases.
- Group preference merging resolves conflicts by combining stated preferences; it does not yet negotiate hard trade-offs (e.g. incompatible budgets).

These are documented rather than hidden because knowing where it breaks is part of the result.

---

## 4. Demo & screenshots (communication)

- **Fastest path:** `npm run dev` → open `http://localhost:3000` → **Load SF demo** (no keys needed).
- **Live generation:** add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) and `NEXT_PUBLIC_MAPBOX_TOKEN`, then type a city and **Generate trip**.
- **Group flow:** create a room, open the link in a second browser, give each "person" different preferences, and build one shared itinerary.

> _Add a short screen recording and a couple of screenshots here for reviewers who won't run it locally — e.g. `docs/demo.mp4`, `docs/solo.png`, `docs/room.png`._

---

## 5. Setup

### Requirements
- Node 20+
- At least one of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for live trip generation (the SF demo needs neither)
- `NEXT_PUBLIC_MAPBOX_TOKEN` for the map (get one free at [Mapbox](https://account.mapbox.com/))

### Quickstart
```bash
cp .env.example .env      # then add your keys (see table below)
npm install
npx prisma db push        # creates the local SQLite DB (needed for group rooms)
npm run dev               # http://localhost:3000
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Primary trip generation (Claude) |
| `OPENAI_API_KEY` | Fallback trip generation + stop-details parsing |
| `NEXT_PUBLIC_MAPBOX_TOKEN` / `MAPBOX_ACCESS_TOKEN` | Map render + geocoding + directions (server token optional) |
| `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` | Higher-quality place search & city confirmation |
| `DATABASE_URL` | SQLite via Prisma (required for group rooms) |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | Override default models |
| `LORE_USE_FERRET`, `LORE_FERRET_CDP`, `FERRET_PATH` | Optional [MontFerret CLI](https://github.com/MontFerret/cli) for JS-heavy venue pages |
| `LORE_USE_SCRAPY`, `LORE_PYTHON` | Optional [Scrapy](https://github.com/scrapy/scrapy) for heavier HTML extraction |

Without Mapbox/Google keys, the app falls back to keyless **OSRM** (routing) and **Photon** (geocoding) where possible.

---

## 6. Architecture (at a glance)

```
Browser (Next.js App Router, React 18, Tailwind, framer-motion)
  ├─ TripPlannerClient ........ solo chat-first planner + map + timeline
  └─ GroupTripRoomClient ...... per-participant columns + shared map
        │
        ▼  fetch (NDJSON stream)
API routes (/api/trip/*)
  ├─ plan ..... streams the itinerary build, event by event
  ├─ chat ..... conversational form editing / pref extraction
  ├─ room/* ... create, join, message, build (async, lock-guarded)
  ├─ directions / nearby / geocode / city-candidates / stop-details
        │
        ▼
Services (src/lib)
  ├─ trip-plan-service ... LLM streaming + custom JSONL parser + assembly
  ├─ trip-optimize ....... time-buckets → nearest-neighbor → 2-opt
  ├─ trip-geocode ........ Google → Mapbox → Photon, city resolution
  ├─ trip-enrich ......... venue details (cheerio / Ferret / Scrapy)
  ├─ weather ............. Open-Meteo, date-aware
  └─ room-* .............. preference merge → unified draft
        │
        ▼
Prisma + SQLite (TripRoom, RoomParticipant, RoomMessage, ParticipantPreferences)
```

---

## 7. Process, integrity & disclosure

**AI usage in building this project.** This project was developed with heavy AI assistance, including Claude Code, used for scaffolding, refactors, and parts of the implementation. All AI-generated code was reviewed, integrated, tested, and iterated on by the author; the architectural decisions (the deterministic-routing-over-LLM split, the group-room model, day-by-day streaming) and the product direction are the author's. The application itself also *uses* LLMs at runtime (Claude / GPT) as its core feature — that is the product, and it is disclosed to users (e.g. "Generate trip" requires an API key).

**Sources, services & credits.**
- **Models / APIs:** Anthropic Claude, OpenAI GPT.
- **Maps & geodata:** [Mapbox GL](https://www.mapbox.com/) (map + geocoding + directions), [Google Places/Maps](https://developers.google.com/maps) (optional place search), [OSRM](https://project-osrm.org/) (keyless routing fallback), [Photon / Komoot](https://photon.komoot.io/) (keyless geocoding fallback).
- **Weather:** [Open-Meteo](https://open-meteo.com/) (no key required).
- **Key libraries:** Next.js, React, Prisma, Tailwind CSS, framer-motion, `@dnd-kit`, Zod, Cheerio, `react-map-gl`, `lucide-react`. Optional fetch tooling: [MontFerret](https://github.com/MontFerret/cli), [Scrapy](https://github.com/scrapy/scrapy).
- This is **not a fork** — it was built from scratch on `create-next-app`. The libraries above are dependencies, not borrowed source.

**Decisions, limitations & effort over time.** Major design decisions and known limitations are documented in §1–§3. The public commit history (`git log`) shows development from the initial commit (Apr 26, 2026) through the streaming itinerary build (May 30, 2026), including a deliberate scope cut of an earlier "quest feed / lab" direction to focus on the trip planner.

---

## 8. Troubleshooting

1. **`Module not found` / 500 on `/` with Turbopack.** The map uses `mapbox-gl` + `react-map-gl`, which Turbopack (`next dev --turbo`) often fails to resolve in dev. Use **`npm run dev`** (Webpack). Production `next build` is fine.
2. **TypeScript/IDE errors** — in VS Code, "TypeScript: Select TypeScript Version" → **Use Workspace Version** (see `.vscode/settings.json`).
3. **Duplicate files in `node_modules/.prisma`** (e.g. `client 2.ts`) — remove `node_modules` and `.next`, then `npm install` && `npx prisma generate`.
4. **File-watcher / hot-reload issues** — `npm run dev:poll`.
5. **`npm warn Unknown env config "devdir"`** — from your global npm config; safe to ignore.
