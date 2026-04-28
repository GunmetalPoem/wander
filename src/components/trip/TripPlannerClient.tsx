"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultTripForm,
  demoTripSanFrancisco,
  type TripFormInput,
  type TripPlan,
} from "@/lib/trip-schema";
import { replaceDayStops } from "@/lib/trip-mutate";
import { scheduleDayStops } from "@/lib/trip-time";
import { TripForm } from "./TripForm";
import { TripTimeline } from "./TripTimeline";
import { TripSummary } from "./TripSummary";

const TripMap = dynamic(() => import("./TripMap").then((m) => m.TripMap), {
  ssr: false,
  loading: () => <div className="h-full min-h-[400px] w-full animate-pulse rounded-2xl bg-white/5" />,
});

type Leg = { durationSeconds: number; distanceMeters: number };

type RouteFeatureState = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
} | null;

export function TripPlannerClient() {
  const [form, setForm] = useState<TripFormInput>(defaultTripForm);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [routeFeature, setRouteFeature] = useState<RouteFeatureState>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [nearby, setNearby] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  const dayNumbers = useMemo(() => plan?.trip.days.map((d) => d.day) ?? [], [plan]);
  const currentStops = useMemo(
    () => plan?.trip.days.find((d) => d.day === activeDay)?.stops ?? [],
    [plan, activeDay],
  );

  const legSeconds = useMemo(() => legs.map((l) => l.durationSeconds), [legs]);
  const scheduled = useMemo(
    () => scheduleDayStops(currentStops, legSeconds, 9, 0),
    [currentStops, legSeconds],
  );

  const totalDistanceKm = useMemo(
    () => (legs.length ? legs.reduce((a, l) => a + l.distanceMeters, 0) / 1000 : null),
    [legs],
  );
  const totalWalkMinutes = useMemo(
    () => (legs.length ? legs.reduce((a, l) => a + l.durationSeconds, 0) / 60 : null),
    [legs],
  );

  useEffect(() => {
    if (!plan) {
      setRouteFeature(null);
      setLegs([]);
      return;
    }
    const coordStops = currentStops.filter(
      (s) => typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng),
    );
    if (coordStops.length < 2 || coordStops.length !== currentStops.length) {
      setRouteFeature(null);
      setLegs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/trip/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: form.transport,
          coordinates: coordStops.map((s) => [s.lng, s.lat] as [number, number]),
        }),
      });
      if (!res.ok || cancelled) {
        if (!cancelled) {
          setRouteFeature(null);
          setLegs([]);
        }
        return;
      }
      const data = (await res.json()) as {
        routeGeojson: NonNullable<RouteFeatureState>;
        legs: Leg[];
      };
      if (cancelled) return;
      setRouteFeature(data.routeGeojson);
      setLegs(data.legs ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, activeDay, form.transport, currentStops]);

  useEffect(() => {
    if (!selectedStopId || !plan) {
      setNearby([]);
      return;
    }
    const s = currentStops.find((x) => x.id === selectedStopId);
    if (!s) {
      setNearby([]);
      return;
    }
    const { lat, lng } = s;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setNearby([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/trip/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&type=lunch`,
      );
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        results: { id: string; name: string; lat: number; lng: number }[];
      };
      if (cancelled) return;
      setNearby(data.results ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStopId, plan, currentStops]);

  const onSubmit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/trip/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: form.city,
          cityCenter: form.cityCenter,
          days: form.days,
          groupSize: form.groupSize,
          budget: form.budget,
          pace: form.pace,
          vibes: form.vibes,
          mustInclude: form.mustInclude,
          transport: form.transport,
        }),
      });
      const data = (await res.json()) as { error?: string; plan?: TripPlan };
      if (!res.ok) {
        setErr(data.error ?? "Plan failed");
        return;
      }
      if (data.plan) {
        setPlan(data.plan);
        setActiveDay(1);
        setSelectedStopId(data.plan.trip.days[0]?.stops[0]?.id ?? null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [form]);

  const onLoadDemo = useCallback(() => {
    setErr(null);
    setForm({
      ...form,
      city: "San Francisco, California, United States",
      cityCenter: { lat: 37.7749, lng: -122.4194 },
      cityLocationReady: true,
    });
    setPlan(demoTripSanFrancisco);
    setActiveDay(1);
    setSelectedStopId(demoTripSanFrancisco.trip.days[0]!.stops[0]!.id);
  }, [form]);

  const onReorder = useCallback(
    (reordered: (typeof currentStops)[number][]) => {
      if (!plan) return;
      setPlan(replaceDayStops(plan, activeDay, reordered));
    },
    [plan, activeDay],
  );

  const extraMarkers = useMemo(
    () => nearby.map((n) => ({ id: n.id, name: n.name, lat: n.lat, lng: n.lng, color: "#60a5fa" })),
    [nearby],
  );

  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-3 lg:h-[calc(100vh-5.5rem)] lg:flex-row lg:gap-4">
      <section className="order-2 flex min-h-0 w-full flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-1 lg:order-1 lg:max-h-full lg:w-[400px] lg:max-w-[40vw]">
        <TripForm
          value={form}
          onChange={setForm}
          onSubmit={onSubmit}
          onLoadDemo={onLoadDemo}
          busy={busy}
        />
        {err && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>
        )}
        {plan && (
          <>
            <TripSummary
              plan={plan}
              activeDay={activeDay}
              totalWalkMinutes={totalWalkMinutes}
              totalDistanceKm={totalDistanceKm}
              stopCount={currentStops.length}
            />
            <h3 className="text-xs uppercase tracking-widest text-parchment/50">Timeline</h3>
            <TripTimeline
              dayNumbers={dayNumbers}
              activeDay={activeDay}
              onDayChange={setActiveDay}
              scheduled={scheduled}
              onReorder={onReorder}
              selectedStopId={selectedStopId}
              onSelectStop={setSelectedStopId}
            />
            <div className="flex flex-wrap gap-2 border-t border-white/5 pt-2">
              <button
                type="button"
                className="text-xs text-ember/90 hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
                }}
              >
                Copy trip JSON
              </button>
              {selectedStopId && (
                <span className="text-[10px] text-parchment/50">
                  Blue dots: nearby places (search). Pick a stop on the map or list.
                </span>
              )}
            </div>
          </>
        )}
        {!plan && !busy && (
          <p className="text-xs text-parchment/50">
            Generate a trip with AI, or <strong>Load SF demo</strong> to see the map, route line, and timeline without any
            API keys.
          </p>
        )}
      </section>
      <section className="order-1 relative h-[50vh] min-h-[300px] flex-1 overflow-hidden rounded-2xl border border-white/10 lg:order-2 lg:h-auto">
        {plan ? (
          <TripMap
            mapboxToken={mapboxToken}
            plan={plan}
            activeDay={activeDay}
            selectedStopId={selectedStopId}
            onSelectStop={setSelectedStopId}
            routeFeature={routeFeature}
            extraMarkers={extraMarkers}
          />
        ) : (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 p-6 text-center text-parchment/60">
            <p className="font-serif text-lg text-parchment/90">Your itinerary map will appear here</p>
            <p className="max-w-sm text-sm">Generate a trip or load the San Francisco demo. Set a Mapbox public token in .env for the map; routing uses your token when set, or OSRM as a fallback.</p>
          </div>
        )}
      </section>
    </div>
  );
}
