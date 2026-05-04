"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Map, { Layer, Marker, NavigationControl, Source } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { TripPlan, TripStop } from "@/lib/trip-schema";

type ExtraMarker = { id: string; name: string; lat: number; lng: number; color?: string };

type Props = {
  mapboxToken: string;
  plan: TripPlan;
  activeDay: number;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  routeFeature: {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  } | null;
  extraMarkers?: ExtraMarker[];
};

function stopsForDay(plan: TripPlan, day: number): TripStop[] {
  const d = plan.trip.days.find((x) => x.day === day);
  return d?.stops ?? [];
}

function hasStopCoords(s: TripStop): s is TripStop & { lat: number; lng: number } {
  return (
    typeof s.lat === "number" &&
    typeof s.lng === "number" &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng)
  );
}

function firstResolvedStop(plan: TripPlan): (TripStop & { lat: number; lng: number }) | null {
  for (const d of plan.trip.days) {
    for (const s of d.stops) {
      if (hasStopCoords(s)) return s;
    }
  }
  return null;
}

function centerForPlan(plan: TripPlan): { lat: number; lng: number; zoom: number } {
  const c = plan.trip.city_center;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
    return { lat: c.lat, lng: c.lng, zoom: 12 };
  }
  const first = firstResolvedStop(plan);
  if (first) {
    return { lat: first.lat, lng: first.lng, zoom: 12 };
  }
  return { lat: 37.7749, lng: -122.4194, zoom: 12 };
}

export function TripMap({
  mapboxToken,
  plan,
  activeDay,
  selectedStopId,
  onSelectStop,
  routeFeature,
  extraMarkers = [],
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const stops = useMemo(() => stopsForDay(plan, activeDay), [plan, activeDay]);
  const resolvedStops = useMemo(() => stops.filter(hasStopCoords), [stops]);
  const unresolvedCount = stops.length - resolvedStops.length;
  const c = useMemo(() => centerForPlan(plan), [plan]);

  const initialView = useMemo(
    () => ({
      longitude: c.lng,
      latitude: c.lat,
      zoom: c.zoom,
      pitch: 55,
      bearing: -25,
    }),
    [c.lat, c.lng, c.zoom],
  );

  const flyTo = useCallback((lat: number, lng: number) => {
    const m = mapRef.current?.getMap();
    m?.flyTo({
      center: [lng, lat],
      zoom: 15.5,
      pitch: 60,
      bearing: 20,
      duration: 1500,
      essential: true,
    });
  }, []);

  const onLoad = useCallback((e: { target: mapboxgl.Map }) => {
    const map = e.target;

    /** 3D ground + volumetric buildings (streets-v12 does not bundle Standard-style 3D “city meshes”). */
    const ensureDemSource = () => {
      if (map.getSource("mapbox-dem")) return;
      try {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      } catch {
        /* style may already define a different terrain source id */
      }
    };

    try {
      ensureDemSource();
      if (map.getSource("mapbox-dem")) {
        // Subtle elevation; high exaggeration + fog reads as “the map went dull” once terrain resolves.
        map.setTerrain({ source: "mapbox-dem", exaggeration: 0.85 });
      }
      // Avoid “spotlight/vignette” effects that can make markers feel like they fade by screen position.
      // Keep terrain, but remove fog + custom light.
      map.setFog(null);
    } catch {
      /* ignore unsupported env */
    }

    /** Add 3D buildings from composite vector tiles (shows up when zoomed in). */
    if (!map.getSource("composite")) return;
    try {
      if (!map.getLayer("3d-buildings")) {
        map.addLayer(
          {
            id: "3d-buildings",
            source: "composite",
            "source-layer": "building",
            filter: ["==", ["get", "extrude"], "true"],
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": [
                "interpolate",
                ["linear"],
                ["get", "height"],
                0,
                "#cbd5e1",
                60,
                "#94a3b8",
                200,
                "#64748b",
              ],
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                15,
                ["get", "height"],
              ],
              "fill-extrusion-base": ["get", "min_height"],
              // Keep buildings readable without dimming streets/labels underneath.
              "fill-extrusion-opacity": 0.55,
              "fill-extrusion-ambient-occlusion-intensity": 0.12,
              "fill-extrusion-emissive-strength": 0,
            },
          },
          "tunnel-minor-case",
        );
      }
    } catch {
      // style may not have tunnel-minor-case; fallback without insertion order
      try {
        if (!map.getLayer("3d-buildings")) {
          map.addLayer({
            id: "3d-buildings",
            source: "composite",
            "source-layer": "building",
            filter: ["==", ["get", "extrude"], "true"],
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": "#94a3b8",
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["get", "min_height"],
              "fill-extrusion-opacity": 0.52,
              "fill-extrusion-ambient-occlusion-intensity": 0.12,
              "fill-extrusion-emissive-strength": 0,
            },
          });
        }
      } catch {
        /* composite layer differs by style/version */
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedStopId) return;
    const s = stops.find((x) => x.id === selectedStopId);
    if (s && hasStopCoords(s)) flyTo(s.lat, s.lng);
  }, [selectedStopId, stops, flyTo]);

  if (!mapboxToken) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-2xl border border-amber-500/30 bg-black/50 p-6 text-center text-sm text-parchment/80">
        Add <code className="text-ember">NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code className="text-ember">.env</code> (your
        default <strong>public</strong> token from{" "}
        <a className="text-ember underline" href="https://account.mapbox.com/">
          Mapbox
        </a>
        ) to show the 3D map.
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-[360px]">
      <Map
        ref={mapRef}
        mapboxAccessToken={mapboxToken}
        initialViewState={initialView}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        style={{ width: "100%", height: "100%" }}
        interactiveLayerIds={[]}
        reuseMaps
        onLoad={onLoad}
      >
        <NavigationControl position="top-left" showCompass />
        {routeFeature && (
          <Source id="route" type="geojson" data={routeFeature}>
            <Layer
              id="route-line"
              type="line"
              paint={{
                "line-color": "#f97316",
                "line-width": 4,
                "line-opacity": 0.9,
              }}
            />
          </Source>
        )}
        {unresolvedCount > 0 && (
          <div className="absolute bottom-3 right-3 z-10 max-w-[220px] rounded-lg border border-amber-500/30 bg-black/80 px-2.5 py-1.5 text-[10px] text-amber-200/90">
            {unresolvedCount} {unresolvedCount === 1 ? "stop" : "stops"} with no map pin (place could not be matched in this
            area).
          </div>
        )}
        {resolvedStops.map((s) => {
          const i = stops.findIndex((x) => x.id === s.id);
          return (
            <Marker
              key={s.id}
              longitude={s.lng}
              latitude={s.lat}
              anchor="center"
              pitchAlignment="viewport"
              rotationAlignment="viewport"
              style={{ zIndex: 10001 }}
              onClick={(e) => {
                e.originalEvent?.stopPropagation?.();
                onSelectStop(s.id);
              }}
            >
              <button
                type="button"
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold shadow-[0_10px_25px_rgba(0,0,0,0.55)] transition ${
                  selectedStopId === s.id
                    ? "border-ember bg-ember text-white"
                    : "border-white bg-slate-950 text-white hover:border-ember"
                } ${
                  s.locationConfidence != null && s.locationConfidence < 0.6 ? "ring-2 ring-amber-500/60" : ""
                }`}
                aria-label={s.name}
              >
                {i < 0 ? 1 : i + 1}
              </button>
            </Marker>
          );
        })}
        {extraMarkers.map((m) => (
          <Marker
            key={m.id}
            longitude={m.lng}
            latitude={m.lat}
            anchor="center"
            pitchAlignment="viewport"
            rotationAlignment="viewport"
            style={{ zIndex: 10000 }}
          >
            <span
              className="block h-2.5 w-2.5 rounded-full border border-white shadow"
              style={{ background: m.color ?? "#60a5fa" }}
              title={m.name}
            />
          </Marker>
        ))}
      </Map>
    </div>
  );
}
