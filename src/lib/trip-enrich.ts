import type { TripPlan, TripStop } from "@/lib/trip-schema";

type OverpassElement =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: "way"; id: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
  | { type: "relation"; id: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameScore(a: string, b: string): number {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  // crude token overlap
  const ta = new Set(na.split(" ").filter((x) => x.length > 2));
  const tb = new Set(nb.split(" ").filter((x) => x.length > 2));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const denom = Math.max(1, Math.min(ta.size, tb.size));
  return Math.min(0.8, inter / denom);
}

function stopCenter(stop: TripStop): { lat: number; lng: number } | null {
  if (typeof stop.lat !== "number" || typeof stop.lng !== "number") return null;
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return null;
  return { lat: stop.lat, lng: stop.lng };
}

function coalesceTag(tags: Record<string, string> | undefined, keys: string[]): string | null {
  if (!tags) return null;
  for (const k of keys) {
    const v = tags[k];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

async function overpassLookupNearby(
  lat: number,
  lng: number,
  radiusM = 120,
): Promise<OverpassElement[]> {
  // target POI-ish objects likely to have hours/cuisine/wheelchair tags
  const q = `
[out:json][timeout:12];
(
  node(around:${radiusM},${lat},${lng})["name"];
  way(around:${radiusM},${lat},${lng})["name"];
  relation(around:${radiusM},${lat},${lng})["name"];
);
out center tags 30;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: q,
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { elements?: OverpassElement[] };
  return Array.isArray(j.elements) ? j.elements : [];
}

function elementName(el: OverpassElement): string {
  return el.tags?.name ?? "";
}

function elementLatLng(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.type === "node") return { lat: el.lat, lng: el.lon };
  const c = el.center;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) return { lat: c.lat, lng: c.lon };
  return null;
}

function pickBestElement(stop: TripStop, els: OverpassElement[]): OverpassElement | null {
  const best = els
    .map((el) => ({ el, score: nameScore(stop.name, elementName(el)) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.45) return null;
  return best.el;
}

function applyOsmDetails(stop: TripStop, el: OverpassElement): TripStop {
  const tags = el.tags ?? {};
  const opening = coalesceTag(tags, ["opening_hours", "opening_hours:signed"]);
  const cuisine = coalesceTag(tags, ["cuisine"]);
  const wheelchair = coalesceTag(tags, ["wheelchair"]);
  const website = coalesceTag(tags, ["website", "contact:website"]);
  const phone = coalesceTag(tags, ["phone", "contact:phone"]);

  const openingHoursText = opening ? [opening] : undefined;
  const wheelchairAccessibleEntrance =
    wheelchair === "yes" ? true : wheelchair === "no" ? false : undefined;

  return {
    ...stop,
    details: {
      ...(stop.details ?? {}),
      provider: "osm",
      types: stop.details?.types,
      cuisine: stop.details?.cuisine ?? cuisine ?? undefined,
      openingHoursText: stop.details?.openingHoursText ?? openingHoursText,
      website: (stop.details?.website ?? (website && website.startsWith("http") ? website : undefined)) as
        | string
        | undefined,
      phone: stop.details?.phone ?? phone ?? undefined,
      wheelchairAccessibleEntrance:
        stop.details?.wheelchairAccessibleEntrance ?? wheelchairAccessibleEntrance,
    },
  };
}

/**
 * Best-effort enrichment using OpenStreetMap tags via Overpass.
 * Adds cuisine/opening_hours/wheelchair/website/phone when available.
 */
export async function enrichTripPlan(plan: TripPlan): Promise<TripPlan> {
  const days = [];
  for (const d of plan.trip.days) {
    const stops: TripStop[] = [];
    for (const s of d.stops) {
      const c = stopCenter(s);
      if (!c) {
        stops.push(s);
        continue;
      }
      try {
        const els = await overpassLookupNearby(c.lat, c.lng, 140);
        const best = pickBestElement(s, els);
        stops.push(best ? applyOsmDetails(s, best) : s);
      } catch {
        stops.push(s);
      }
    }
    days.push({ ...d, stops });
  }
  return { ...plan, trip: { ...plan.trip, days } };
}

