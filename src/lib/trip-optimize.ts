import type { TripDay, TripPlan, TripStop } from "@/lib/trip-schema";

type Center = { lat: number; lng: number };

function hasCoords(s: TripStop): s is TripStop & { lat: number; lng: number } {
  return typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

function haversineKm(a: Center, b: Center): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

const BEST_ORDER = new Map<string, number>([
  ["early_morning", 0],
  ["morning", 1],
  ["midday", 2],
  ["afternoon", 3],
  ["evening", 4],
  ["night", 5],
]);

function bestBucket(s: TripStop): number {
  const k = (s.best_time ?? "morning") as string;
  return BEST_ORDER.get(k) ?? 1;
}

function isMealStop(s: TripStop): boolean {
  const hay = `${s.category} ${s.name} ${s.address}`.toLowerCase();
  return (
    /food|restaurant|dining|lunch|dinner|brunch|café|cafe|coffee|bakery|bar\b|wine|meal|eat|taco|pizza|sushi|bistro|kitchen|market|deli/.test(
      hay,
    ) || s.category.toLowerCase().includes("food")
  );
}

/** Nudge meal stops into plausible dayparts for ordering so lunch is not routed before morning sights. */
function effectiveOrderBucket(s: TripStop): number {
  let b = bestBucket(s);
  const meal = isMealStop(s);
  const text = `${s.name} ${s.description}`.toLowerCase();
  if (meal && b <= 1) {
    if (/lunch|noon|midday|sandwich|ramen|pho|burger|diner|slice of|pizza/.test(text)) {
      return Math.max(b, 2);
    }
  }
  if (meal && /dinner|supper|evening meal|night market|supper club/.test(text)) {
    return Math.max(b, 4);
  }
  return b;
}

function timeOrderNonDecreasing(stops: TripStop[]): boolean {
  for (let i = 0; i < stops.length - 1; i++) {
    if (effectiveOrderBucket(stops[i + 1]!) < effectiveOrderBucket(stops[i]!)) {
      return false;
    }
  }
  return true;
}

function pathLengthKm(stops: (TripStop & { lat: number; lng: number })[]): number {
  let t = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    t += haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  }
  return t;
}

function reverseSegment<T>(arr: T[], i: number, j: number): T[] {
  const c = arr.slice();
  let a = i;
  let b = j;
  while (a < b) {
    const tmp = c[a]!;
    c[a] = c[b]!;
    c[b] = tmp;
    a++;
    b--;
  }
  return c;
}

/**
 * Shorten the open path with segment reversals while keeping coarse time-of-day non-decreasing.
 */
function twoOptOpenPath(stops: TripStop[]): TripStop[] {
  const coord: (TripStop & { lat: number; lng: number })[] = [];
  const noCoord: TripStop[] = [];
  for (const s of stops) {
    if (hasCoords(s)) coord.push(s);
    else noCoord.push(s);
  }
  if (coord.length < 4) return stops;

  let best = coord.slice();
  let bestLen = pathLengthKm(best);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 80) {
    improved = false;
    for (let i = 0; i < best.length - 2; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const trial = reverseSegment(best, i + 1, j);
        if (!timeOrderNonDecreasing(trial)) continue;
        const len = pathLengthKm(trial as (TripStop & { lat: number; lng: number })[]);
        if (len + 1e-6 < bestLen) {
          best = trial as (TripStop & { lat: number; lng: number })[];
          bestLen = len;
          improved = true;
        }
      }
    }
  }
  return [...best, ...noCoord];
}

/**
 * Greedy nearest-neighbor within each effective time bucket, starting from city center (not first random stop).
 */
function reorderStopsByProximity(stops: TripStop[], start: Center): TripStop[] {
  const byBucket = new Map<number, TripStop[]>();
  for (const s of stops) {
    const b = effectiveOrderBucket(s);
    const arr = byBucket.get(b) ?? [];
    arr.push(s);
    byBucket.set(b, arr);
  }

  const buckets = Array.from(byBucket.keys()).sort((a, b) => a - b);
  const out: TripStop[] = [];
  let cursor: Center = start;

  for (const b of buckets) {
    const pool = (byBucket.get(b) ?? []).slice();
    if (!pool.every(hasCoords)) {
      out.push(...pool);
      const lastCoord = [...pool].reverse().find(hasCoords);
      if (lastCoord) cursor = { lat: lastCoord.lat, lng: lastCoord.lng };
      continue;
    }
    while (pool.length) {
      let bestI = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i] as TripStop & { lat: number; lng: number };
        const d = haversineKm(cursor, { lat: s.lat, lng: s.lng });
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const picked = pool.splice(bestI, 1)[0] as TripStop & { lat: number; lng: number };
      out.push(picked);
      cursor = { lat: picked.lat, lng: picked.lng };
    }
  }
  return out;
}

function dayAnchorCenter(plan: TripPlan, day: TripDay): Center | null {
  const cc = plan.trip.city_center;
  if (cc && Number.isFinite(cc.lat) && Number.isFinite(cc.lng) && !(cc.lat === 0 && cc.lng === 0)) {
    return { lat: cc.lat, lng: cc.lng };
  }
  const first = day.stops.find(hasCoords);
  if (first) return { lat: first.lat, lng: first.lng };
  return null;
}

/**
 * Post-process to shorten within-day paths after geocoding.
 * Anchors routes at trip city_center, orders by time-of-day (with meal nudges), NN within each bucket, then 2-opt.
 */
export function optimizeTripPlanForCloseness(plan: TripPlan): TripPlan {
  const days = plan.trip.days.map((d) => {
    const start = dayAnchorCenter(plan, d);
    if (!start) return d;
    const coordCount = d.stops.filter(hasCoords).length;
    if (coordCount < 3) return d;
    const reordered = reorderStopsByProximity(d.stops, start);
    const refined = twoOptOpenPath(reordered);
    return { ...d, stops: refined };
  });
  return { ...plan, trip: { ...plan.trip, days } };
}
