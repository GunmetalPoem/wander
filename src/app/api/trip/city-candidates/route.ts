import { NextResponse } from "next/server";
import { getGoogleGeoKeyFromEnv } from "@/lib/trip-geocode";
import type { CityCandidate } from "@/lib/trip-city";

function padId(s: string, i: number) {
  return `c_${i}_${s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`;
}

async function mapboxCityCandidates(q: string, token: string): Promise<CityCandidate[]> {
  const path = encodeURIComponent(q.slice(0, 200));
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${path}.json?types=place%2Clocality&limit=8&autocomplete=true&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return [];
  const j = (await res.json()) as {
    features?: Array<{
      id: string;
      place_name: string;
      text?: string;
      center: [number, number];
    }>;
  };
  const out: CityCandidate[] = [];
  for (let i = 0; i < (j.features?.length ?? 0); i++) {
    const f = j.features![i]!;
    const [lng, lat] = f.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = f.place_name || f.text || q;
    out.push({ id: f.id || padId(label, i), label, lat, lng });
  }
  return out;
}

async function googleCityCandidates(q: string, key: string): Promise<CityCandidate[]> {
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", q.slice(0, 200));
  u.searchParams.set("key", key);
  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return [];
  const j = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (j.status === "REQUEST_DENIED" || j.status === "INVALID_REQUEST") {
    console.error("[city-candidates] Geocoding:", j.status, j.error_message);
    return [];
  }
  if (j.status !== "OK" || !j.results?.length) return [];
  return j.results.map((r, i) => ({
    id: `g_${i}`,
    label: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("query") ?? searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ candidates: [] as CityCandidate[] });
  }
  /** This endpoint only feeds the text dropdown (no map). Prefer Google when configured so Mapbox is not used here. */
  const google = getGoogleGeoKeyFromEnv();
  const mapbox = (process.env.MAPBOX_ACCESS_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();

  if (google) {
    const c = await googleCityCandidates(q, google);
    if (c.length) {
      return NextResponse.json({ candidates: c, source: "google" as const });
    }
  }
  if (mapbox) {
    const c = await mapboxCityCandidates(q, mapbox);
    if (c.length) {
      return NextResponse.json({ candidates: c, source: "mapbox" as const });
    }
  }
  return NextResponse.json({ candidates: [] as CityCandidate[], source: "none" as const });
}
