import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  profile: z.enum(["walking", "driving"]),
  coordinates: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .max(25),
});

const OSRM_BASE = "https://router.project-osrm.org/route/v1";

function mapboxToken() {
  return process.env.MAPBOX_ACCESS_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
}

/**
 * Mapbox Directions when a token is set; otherwise public OSRM (no key).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { profile, coordinates } = parsed.data;
  const token = mapboxToken();

  if (token) {
    const service = profile === "walking" ? "mapbox/walking" : "mapbox/driving";
    const coordStr = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/${service}/${coordStr}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `Mapbox directions failed: ${res.status}`, detail: t.slice(0, 200) },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      routes?: Array<{
        duration: number;
        distance: number;
        geometry: { type: "LineString"; coordinates: [number, number][] };
        legs: Array<{ duration: number; distance: number; summary: string }>;
      }>;
    };
    const route = data.routes?.[0];
    if (!route) {
      return NextResponse.json({ error: "No route found" }, { status: 404 });
    }
    return NextResponse.json({
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      routeGeojson: {
        type: "Feature" as const,
        properties: {},
        geometry: route.geometry,
      },
      legs: route.legs.map((l) => ({
        durationSeconds: l.duration,
        distanceMeters: l.distance,
      })),
      provider: "mapbox" as const,
    });
  }

  const p = profile === "walking" ? "foot" : "car";
  const coordStr = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `${OSRM_BASE}/${p}/${coordStr}?geometries=geojson&overview=full`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json(
      { error: `OSRM route failed: ${res.status}`, detail: t.slice(0, 200) },
      { status: 502 },
    );
  }
  const data = (await res.json()) as {
    code: string;
    routes?: Array<{
      duration: number;
      distance: number;
      geometry: { type: "LineString"; coordinates: [number, number][] };
      legs: Array<{ duration: number; distance: number }>;
    }>;
  };
  if (data.code !== "Ok" || !data.routes?.[0]) {
    return NextResponse.json({ error: "No route found" }, { status: 404 });
  }
  const route = data.routes[0]!;
  return NextResponse.json({
    durationSeconds: route.duration,
    distanceMeters: route.distance,
    routeGeojson: {
      type: "Feature" as const,
      properties: {},
      geometry: route.geometry,
    },
    legs: route.legs.map((l) => ({
      durationSeconds: l.duration,
      distanceMeters: l.distance,
    })),
    provider: "osrm" as const,
  });
}
