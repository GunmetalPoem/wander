import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const QSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  type: z.enum(["lunch", "coffee", "bathroom", "dessert"]).default("lunch"),
});

const mapboxSearchQueries: Record<string, string> = {
  lunch: "restaurant lunch",
  coffee: "coffee cafe",
  bathroom: "public restroom",
  dessert: "dessert bakery",
};

const photonQueries: Record<string, string> = {
  lunch: "restaurant",
  coffee: "cafe",
  bathroom: "toilet",
  dessert: "bakery",
};

type PhotonRes = {
  features?: Array<{
    geometry: { type: string; coordinates: [number, number] };
    properties?: { name?: string; osm_id?: number; id?: string };
  }>;
};

function mapboxToken() {
  return process.env.MAPBOX_ACCESS_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
}

/**
 * Mapbox Geocoding when a token is set; otherwise Photon.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = QSchema.safeParse({
    lat: searchParams.get("lat"),
    lng: searchParams.get("lng"),
    type: searchParams.get("type") ?? "lunch",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });
  }
  const { lat, lng, type } = parsed.data;
  const token = mapboxToken();

  if (token) {
    const q = mapboxSearchQueries[type] ?? mapboxSearchQueries.lunch;
    const path = encodeURIComponent(q);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${path}.json?proximity=${lng},${lat}&types=poi&limit=6&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: t.slice(0, 200) }, { status: 502 });
    }
    const data = (await res.json()) as {
      features?: Array<{
        id: string;
        text: string;
        place_name: string;
        center: [number, number];
        place_type: string[];
      }>;
    };
    const results =
      data.features?.map((f) => ({
        id: f.id,
        name: f.text,
        placeName: f.place_name,
        lng: f.center[0],
        lat: f.center[1],
      })) ?? [];
    return NextResponse.json({ results, provider: "mapbox" as const });
  }

  const q = photonQueries[type] ?? photonQueries.lunch;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&limit=8&lang=en`;
  const res = await fetch(url, {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json({ error: t.slice(0, 200) }, { status: 502 });
  }
  const data = (await res.json()) as PhotonRes;
  const results =
    data.features?.map((f, i) => {
      const [plng, plat] = f.geometry?.coordinates ?? [0, 0];
      const id = `photon-${f.properties?.osm_id ?? f.properties?.id ?? i}`;
      return {
        id,
        name: f.properties?.name?.trim() || (q[0]!.toUpperCase() + q.slice(1)),
        placeName: f.properties?.name,
        lng: plng,
        lat: plat,
      };
    }) ?? [];
  return NextResponse.json({ results, provider: "photon" as const });
}
