import { distance } from "fastest-levenshtein";
import type { TripPlan, TripStop } from "@/lib/trip-schema";

type Center = { lat: number; lng: number };

/** Mapbox name-match threshold. */
const MAPBOX_MIN_CONF = 0.4;
/**
 * Google: primary resolver — more permissive; also accept strong geographic match when
 * the search was biased to the trip city.
 */
const GOOGLE_MIN_CONF = 0.25;
const MAX_QUERY = 400;
const MAX_RADIUS_M = 50000;

type SearchBoxFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name?: string;
    name_preferred?: string;
    feature_type?: string;
    full_address?: string;
  };
};

type CityContext = {
  center: Center;
  bbox: string;
  country?: string;
};

export function getGoogleGeoKeyFromEnv(): string | undefined {
  return (
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.MAPS_PLACES_KEY?.trim() ||
    undefined
  );
}

function nameSimilarity(a: string, b: string): number {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na.length && !nb.length) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return Math.max(0, (maxLen - distance(na, nb)) / maxLen);
}

function containsHint(haystack: string, needle: string): boolean {
  if (!needle.trim() || !haystack.trim()) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase().trim());
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

function displayName(f: SearchBoxFeature): string {
  const p = f.properties;
  return (p.name_preferred?.trim() || p.name || "").trim();
}

function featureScore(stop: TripStop, feature: SearchBoxFeature, cityCenter: Center): number {
  const pname = displayName(feature);
  if (!pname) return 0;
  const sim = Math.max(
    nameSimilarity(stop.name, pname),
    nameSimilarity(`${stop.name} ${stop.address}`.trim(), pname),
  );
  const [flng, flat] = feature.geometry.coordinates;
  if (!Number.isFinite(flat) || !Number.isFinite(flng)) return 0;
  const distPenalty = Math.min(0.15, haversineKm(cityCenter, { lat: flat, lng: flng }) / 200);
  return sim - distPenalty;
}

function pickBestFeature(
  features: SearchBoxFeature[],
  stop: TripStop,
  cityCenter: Center,
): SearchBoxFeature | null {
  if (!features.length) return null;
  const ranked = features
    .map((f) => ({ f, score: featureScore(stop, f, cityCenter) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.f ?? null;
}

/** Mapbox Geocoding: city center + country + optional bbox. */
async function mapboxGeocodePlace(
  city: string,
  token: string,
): Promise<{
  center: Center;
  bbox: [number, number, number, number] | null;
  countryCode: string | undefined;
} | null> {
  const path = encodeURIComponent(city.slice(0, 200));
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${path}.json?types=${encodeURIComponent("place,locality,region")}&limit=1&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    features?: Array<{
      center: [number, number];
      bbox?: [number, number, number, number];
      context?: Array<{ id: string; short_code?: string }>;
    }>;
  };
  const f = j.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let countryCode: string | undefined;
  for (const c of f.context ?? []) {
    if (c.id.startsWith("country") && c.short_code) {
      countryCode = c.short_code.toUpperCase();
      break;
    }
  }
  return { center: { lat, lng }, bbox: f.bbox ?? null, countryCode };
}

/**
 * Google Geocoding (same key as Places if both APIs are enabled in Cloud Console).
 * Used when there is no Mapbox token to still get a city center + viewport bbox.
 */
async function googleGeocodeAddress(
  address: string,
  key: string,
): Promise<{
  center: Center;
  bbox: [number, number, number, number] | null;
} | null> {
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", address.slice(0, 200));
  u.searchParams.set("key", key);
  const res = await fetch(u.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: Array<{
      geometry: {
        location: { lat: number; lng: number };
        viewport?: {
          southwest: { lat: number; lng: number };
          northeast: { lat: number; lng: number };
        };
      };
    }>;
  };
  if (j.status === "REQUEST_DENIED" || j.status === "INVALID_REQUEST") {
    console.error("[trip-geocode] Google Geocoding API:", j.status, j.error_message);
    return null;
  }
  if (j.status !== "OK" || !j.results?.[0]) return null;
  const g = j.results[0]!.geometry;
  const c = g.location;
  if (!g.viewport) return { center: c, bbox: null };
  const { southwest, northeast } = g.viewport;
  return {
    center: { lat: c.lat, lng: c.lng },
    bbox: [southwest.lng, southwest.lat, northeast.lng, northeast.lat],
  };
}

async function resolveCityGeometry(
  city: string,
  mapboxToken: string | null,
  googleKey: string | undefined,
): Promise<{
  center: Center;
  bbox: [number, number, number, number] | null;
  countryCode: string | undefined;
} | null> {
  if (mapboxToken) {
    const m = await mapboxGeocodePlace(city, mapboxToken);
    if (m) {
      return { center: m.center, bbox: m.bbox, countryCode: m.countryCode };
    }
  }
  if (googleKey) {
    const g = await googleGeocodeAddress(city, googleKey);
    if (g) {
      return { center: g.center, bbox: g.bbox, countryCode: undefined };
    }
  }
  return null;
}

function padBbox(center: Center, deg = 0.15): [number, number, number, number] {
  return [center.lng - deg, center.lat - deg, center.lng + deg, center.lat + deg];
}

function bboxString(box: [number, number, number, number]): string {
  return box.map((n) => n.toFixed(6)).join(",");
}

/** Mapbox Search Box /forward */
async function mapboxSearchBoxForward(
  q: string,
  token: string,
  ctx: CityContext,
  types: string,
): Promise<SearchBoxFeature[]> {
  const query = q.slice(0, MAX_QUERY);
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query,
    access_token: token,
    limit: "5",
    types,
    proximity: `${ctx.center.lng},${ctx.center.lat}`,
    bbox: ctx.bbox,
  });
  if (ctx.country) {
    params.set("country", ctx.country);
  }
  const url = `https://api.mapbox.com/search/searchbox/v1/forward?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return [];
  const j = (await res.json()) as { features?: SearchBoxFeature[] };
  return Array.isArray(j.features) ? j.features : [];
}

type GoogleResult = { name: string; lat: number; lng: number; formattedAddress?: string };

/**
 * Text Search (legacy) with optional location+radius biasing to the trip city.
 */
async function googlePlacesTextSearch(
  query: string,
  key: string,
  near: Center,
): Promise<GoogleResult[]> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  u.searchParams.set("query", query.slice(0, MAX_QUERY));
  u.searchParams.set("key", key);
  u.searchParams.set("location", `${near.lat},${near.lng}`);
  u.searchParams.set("radius", String(Math.min(MAX_RADIUS_M, 50000)));
  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return [];
  const j = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: Array<{
      name: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (j.status === "REQUEST_DENIED" || j.status === "INVALID_REQUEST") {
    console.error("[trip-geocode] Google Places Text Search:", j.status, j.error_message);
    return [];
  }
  if (j.status !== "OK" && j.status !== "ZERO_RESULTS") {
    if (j.status && j.status !== "ZERO_RESULTS") {
      console.warn("[trip-geocode] Google Text Search status:", j.status, j.error_message);
    }
  }
  const out: GoogleResult[] = [];
  for (const r of j.results ?? []) {
    const la = r.geometry?.location?.lat;
    const ln = r.geometry?.location?.lng;
    if (typeof la !== "number" || typeof ln !== "number" || !r.name) continue;
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    out.push({ name: r.name, lat: la, lng: ln, formattedAddress: r.formatted_address });
  }
  return out;
}

/** Find Place from Text — good when Text Search is noisy. */
async function googleFindPlaceFromText(
  input: string,
  key: string,
  near: Center,
): Promise<GoogleResult | null> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  u.searchParams.set("input", input.slice(0, MAX_QUERY));
  u.searchParams.set("inputtype", "textquery");
  u.searchParams.set("fields", "name,geometry/location,formatted_address");
  u.searchParams.set("locationbias", `circle:${MAX_RADIUS_M}@${near.lat},${near.lng}`);
  u.searchParams.set("key", key);
  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    status: string;
    error_message?: string;
    candidates?: Array<{
      name: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (j.status === "REQUEST_DENIED" || j.status === "INVALID_REQUEST") {
    console.error("[trip-geocode] Google Find Place:", j.status, j.error_message);
    return null;
  }
  if (j.status !== "OK" && j.status !== "ZERO_RESULTS") return null;
  const c = j.candidates?.[0];
  if (!c?.name) return null;
  const la = c.geometry?.location?.lat;
  const ln = c.geometry?.location?.lng;
  if (typeof la !== "number" || typeof ln !== "number") return null;
  return { name: c.name, lat: la, lng: ln, formattedAddress: c.formatted_address };
}

function pickFromGoogleCandidates(
  cands: GoogleResult[],
  stop: TripStop,
  city: string,
  cityCenter: Center,
): { result: GoogleResult; confidence: number; trustGeography: boolean } | null {
  if (!cands.length) return null;
  const scored = cands.map((c) => {
    const simN = nameSimilarity(stop.name, c.name);
    const simA = nameSimilarity(`${stop.name} ${stop.address}`.trim(), c.name);
    const simF = c.formattedAddress
      ? Math.max(
          nameSimilarity(stop.name, c.formattedAddress),
          nameSimilarity(stop.address, c.formattedAddress) * 0.7,
        )
      : 0;
    const sim = Math.max(simN, simA, simF);
    const dKm = haversineKm(cityCenter, { lat: c.lat, lng: c.lng });
    const distP = Math.min(0.2, dKm / 200);
    const inCity = containsHint(c.name, city) || (c.formattedAddress != null && containsHint(c.formattedAddress, city));
    const localBonus = dKm < 30 ? 0.12 : dKm < 80 ? 0.06 : 0;
    const nameBonus = inCity ? 0.08 : 0;
    return {
      c,
      sim,
      dKm,
      score: sim - distP + localBonus + nameBonus,
      trustGeography: dKm < 95 && cands.length <= 8,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;
  let confidence = top.sim;
  if (top.dKm < 12 && (containsHint(top.c.name, stop.name) || cands.length <= 3)) {
    confidence = Math.max(confidence, 0.55);
  }
  return { result: top.c, confidence, trustGeography: top.trustGeography || top.dKm < 45 };
}

function googleAccepts(conf: number, trustGeography: boolean, dKm: number, candsLen: number): boolean {
  if (conf >= GOOGLE_MIN_CONF) return true;
  if (trustGeography && conf >= 0.18 && dKm < 100) return true;
  if (candsLen === 1 && dKm < 150 && conf >= 0.12) return true;
  if (candsLen <= 4 && dKm < 25 && conf >= 0.15) return true;
  return false;
}

async function tryGoogleResolve(
  stop: TripStop,
  city: string,
  cityCenter: Center,
  googleKey: string,
): Promise<TripStop | null> {
  const queries = [
    `${stop.name} ${city}`,
    `${stop.name} ${stop.address} ${city}`,
    `${stop.address} ${city}`,
  ];
  for (const q of queries) {
    const t = q.trim();
    if (t.length < 3) continue;
    const cands = await googlePlacesTextSearch(t, googleKey, cityCenter);
    if (!cands.length) continue;
    const picked = pickFromGoogleCandidates(cands, stop, city, cityCenter);
    if (!picked) continue;
    const dKm = haversineKm(cityCenter, { lat: picked.result.lat, lng: picked.result.lng });
    if (
      googleAccepts(
        picked.confidence,
        picked.trustGeography,
        dKm,
        cands.length,
      )
    ) {
      return {
        ...stop,
        lat: picked.result.lat,
        lng: picked.result.lng,
        locationResolved: true,
        locationConfidence: Math.min(1, picked.confidence),
        resolvedName: picked.result.name,
        resolvedAddress: picked.result.formattedAddress,
      };
    }
  }
  for (const q of [`${stop.name} ${city}`, `${stop.name}, ${city}`]) {
    if (q.trim().length < 2) continue;
    const c = await googleFindPlaceFromText(q, googleKey, cityCenter);
    if (!c) continue;
    const sim = nameSimilarity(stop.name, c.name);
    const dKm = haversineKm(cityCenter, { lat: c.lat, lng: c.lng });
    if (sim >= GOOGLE_MIN_CONF || (dKm < 50 && sim >= 0.18)) {
      return {
        ...stop,
        lat: c.lat,
        lng: c.lng,
        locationResolved: true,
        locationConfidence: Math.min(1, Math.max(sim, 0.4)),
        resolvedName: c.name,
        resolvedAddress: c.formattedAddress,
      };
    }
  }
  return null;
}

/**
 * Fills `city_center` when missing, then resolves each stop.
 * When `GOOGLE_*` is set, **Google Places is tried first** (Text Search + Find Place, biased to the city).
 * Mapbox Search Box is a fallback if Mapbox token is set.
 * City geocoding uses Mapbox when available, otherwise Google Geocoding.
 */
export async function refineTripPlanWithMapbox(
  plan: TripPlan,
  city: string,
  mapboxToken: string | null,
  googleKey: string | undefined = getGoogleGeoKeyFromEnv(),
  /** When the user picked a place in the UI, use this for bias/bbox and final map center (avoids same-name cities). */
  confirmedCityCenter?: { lat: number; lng: number } | null,
): Promise<TripPlan> {
  const confirmed =
    confirmedCityCenter != null &&
    Number.isFinite(confirmedCityCenter.lat) &&
    Number.isFinite(confirmedCityCenter.lng) &&
    !(confirmedCityCenter.lat === 0 && confirmedCityCenter.lng === 0);
  const geo: {
    center: Center;
    bbox: [number, number, number, number] | null;
    countryCode: string | undefined;
  } | null = confirmed
    ? {
        center: { lat: confirmedCityCenter!.lat, lng: confirmedCityCenter!.lng },
        bbox: padBbox({ lat: confirmedCityCenter!.lat, lng: confirmedCityCenter!.lng }, 0.2),
        countryCode: undefined,
      }
    : await resolveCityGeometry(city, mapboxToken, googleKey);
  const fromPlan = plan.trip.city_center;
  const baseCenter: Center | null =
    fromPlan && Number.isFinite(fromPlan.lat) && Number.isFinite(fromPlan.lng) && !(fromPlan.lat === 0 && fromPlan.lng === 0)
      ? { lat: fromPlan.lat, lng: fromPlan.lng }
      : null;
  const cityCenter: Center = geo?.center ?? baseCenter ?? { lat: 0, lng: 0 };
  if (!geo && !baseCenter) {
    return plan;
  }
  const bboxList = geo?.bbox ?? (baseCenter ? padBbox(baseCenter, 0.2) : null);
  const ctx: CityContext = {
    center: cityCenter,
    bbox: bboxString(bboxList ?? padBbox(cityCenter, 0.2)),
    country: geo?.countryCode ? geo.countryCode.toUpperCase() : undefined,
  };

  async function resolveOneStop(
    stop: TripStop,
    sCity: string,
    center: Center,
    mapbox: string | null,
    gKey: string | undefined,
  ): Promise<TripStop> {
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng) || (center.lat === 0 && center.lng === 0)) {
      return { ...stop, lat: null, lng: null, locationResolved: false };
    }

    if (gKey) {
      const g = await tryGoogleResolve(stop, sCity, center, gKey);
      if (g) {
        return g;
      }
    }

    if (mapbox) {
      const nameSimOnly = (feature: SearchBoxFeature) => nameSimilarity(stop.name, displayName(feature) || stop.name);
      const queries = [`${stop.name} ${sCity}`.trim(), `${stop.name} ${stop.address} ${sCity}`.trim()];
      let features: SearchBoxFeature[] = [];
      for (const part of ["poi", "poi,address,street"] as const) {
        for (const q of queries) {
          const f = await mapboxSearchBoxForward(q, mapbox, ctx, part);
          if (f.length) {
            features = f;
            break;
          }
        }
        if (features.length) break;
      }
      if (features.length) {
        const feature = pickBestFeature(features, stop, center);
        if (feature) {
          const rname = displayName(feature) || stop.name;
          const conf = nameSimOnly(feature);
          const [flng, flat] = feature.geometry.coordinates;
          if (Number.isFinite(flat) && Number.isFinite(flng) && conf >= MAPBOX_MIN_CONF) {
            return {
              ...stop,
              lat: flat,
              lng: flng,
              locationResolved: true,
              locationConfidence: Math.min(1, conf),
              resolvedName: rname,
              resolvedAddress: feature.properties.full_address,
            };
          }
        }
      }
    }

    return {
      ...stop,
      lat: null,
      lng: null,
      locationResolved: false,
      locationConfidence: 0,
    };
  }

  const days = [];
  for (const d of plan.trip.days) {
    const stops: TripStop[] = [];
    for (const s of d.stops) {
      stops.push(await resolveOneStop(s, city, cityCenter, mapboxToken, googleKey));
    }
    days.push({ ...d, stops });
  }
  const setCenter = confirmed
    ? { lat: confirmedCityCenter!.lat, lng: confirmedCityCenter!.lng }
    : (plan.trip.city_center ?? (geo ? { lat: geo.center.lat, lng: geo.center.lng } : undefined));
  return {
    ...plan,
    trip: {
      ...plan.trip,
      city_center: setCenter,
      days,
    },
  };
}
