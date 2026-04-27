"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Map, { Layer, Marker, NavigationControl, Source } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
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

function centerForPlan(plan: TripPlan): { lat: number; lng: number; zoom: number } {
  const c = plan.trip.city_center;
  if (c) {
    return { lat: c.lat, lng: c.lng, zoom: 12 };
  }
  const first = plan.trip.days[0]?.stops[0];
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

  useEffect(() => {
    if (!selectedStopId) return;
    const s = stops.find((x) => x.id === selectedStopId);
    if (s) flyTo(s.lat, s.lng);
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
        mapStyle="mapbox://styles/mapbox/standard"
        style={{ width: "100%", height: "100%" }}
        interactiveLayerIds={[]}
        reuseMaps
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
        {stops.map((s, i) => (
          <Marker
            key={s.id}
            longitude={s.lng}
            latitude={s.lat}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent?.stopPropagation?.();
              onSelectStop(s.id);
            }}
          >
            <button
              type="button"
              className={`flex h-8 w-8 -translate-y-0.5 items-center justify-center rounded-full border-2 text-xs font-bold shadow-lg transition ${
                selectedStopId === s.id
                  ? "border-ember bg-ember text-white"
                  : "border-white/80 bg-black/80 text-parchment hover:border-ember"
              }`}
              aria-label={s.name}
            >
              {i + 1}
            </button>
          </Marker>
        ))}
        {extraMarkers.map((m) => (
          <Marker key={m.id} longitude={m.lng} latitude={m.lat} anchor="center">
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
