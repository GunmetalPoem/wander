/** ASCII-only: fetch() header values must be ByteString. */
const UA =
  "Wander/0.1 (+https://github.com/GunmetalPoem/wander) geocoder; educational project - contact if problematic";

export type Geo = { name: string; lat: number; lng: number };

type OpenMeteoResult = {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
};

function formatLabel(r: OpenMeteoResult): string {
  return [r.name, r.admin1, r.country].filter(Boolean).join(", ");
}

/** Returns up to `count` place candidates (Open-Meteo, no API key). */
export async function searchPlaces(rawQuery: string, count = 10): Promise<Geo[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", trimmed);
  u.searchParams.set("count", String(Math.min(20, Math.max(1, count))));
  u.searchParams.set("language", "en");

  const res = await fetch(u.toString(), { headers: { "user-agent": UA }, next: { revalidate: 0 } });
  if (!res.ok) return [];

  const j = (await res.json()) as { results?: OpenMeteoResult[] };
  const rows = j.results ?? [];
  return rows.map((r) => ({
    name: formatLabel(r),
    lat: r.latitude,
    lng: r.longitude,
  }));
}

export async function geocodeFirst(rawQuery: string): Promise<Geo | null> {
  const all = await searchPlaces(rawQuery, 1);
  return all[0] ?? null;
}
