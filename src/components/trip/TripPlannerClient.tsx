"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { TripWeather } from "@/lib/weather";
import type { TripStop } from "@/lib/trip-schema";

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
  const [weather, setWeather] = useState<TripWeather | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [deepDetailsByStopId, setDeepDetailsByStopId] = useState<Record<string, TripStop["details"]>>({});
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepHintByStopId, setDeepHintByStopId] = useState<Record<string, string>>({});
  const deepDetailsRef = useRef<Record<string, TripStop["details"]>>({});
  const deepInFlightRef = useRef<Set<string>>(new Set());
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
  const expandedStop = useMemo(
    () => (expandedStopId ? currentStops.find((s) => s.id === expandedStopId) ?? null : null),
    [expandedStopId, currentStops],
  );
  const expandedMergedDetails = useMemo(() => {
    if (!expandedStop) return null;
    const deep = deepDetailsByStopId[expandedStop.id];
    if (!deep) return expandedStop.details ?? null;
    return { ...(expandedStop.details ?? {}), ...deep };
  }, [expandedStop, deepDetailsByStopId]);
  const expandedDeepHint = useMemo(
    () => (expandedStop ? deepHintByStopId[expandedStop.id] ?? null : null),
    [expandedStop, deepHintByStopId],
  );

  useEffect(() => {
    deepDetailsRef.current = deepDetailsByStopId;
  }, [deepDetailsByStopId]);

  const fetchDeepDetails = useCallback(
    async (stop: TripStop) => {
      const website = stop.details?.website ?? null;
      const ticketingUrl = stop.details?.ticketingUrl ?? null;
      const placeId = stop.details?.placeId ?? null;
      if (!website && !ticketingUrl && !placeId) return;
      const existing = deepDetailsRef.current[stop.id];
      if (existing?.menuHighlights?.length || existing?.admission || existing?.fees || existing?.ticketingUrl) return;
      if (deepInFlightRef.current.has(stop.id)) return;
      deepInFlightRef.current.add(stop.id);
      const res = await fetch("/api/trip/stop-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stop: {
            name: stop.name,
            address: stop.address,
            category: stop.category,
            website,
            ticketingUrl,
            placeId,
          },
        }),
      });
      try {
        if (!res.ok) return;
        const data = (await res.json()) as { details?: TripStop["details"]; hint?: string };
        if (typeof data.hint === "string" && data.hint.trim()) {
          setDeepHintByStopId((prev) => ({ ...prev, [stop.id]: data.hint!.trim() }));
        }
        if (data.details) {
          setDeepDetailsByStopId((prev) => ({ ...prev, [stop.id]: data.details }));
        }
      } finally {
        deepInFlightRef.current.delete(stop.id);
      }
    },
    [],
  );

  // Prefetch deep details in the background so expand feels instant.
  useEffect(() => {
    if (!plan) return;
    const stopsToPrefetch = currentStops.slice(0, 6);
    let cancelled = false;
    (async () => {
      // small concurrency to keep UI snappy and avoid hammering sources
      const queue = stopsToPrefetch.filter((s) => s.details?.website || s.details?.ticketingUrl || s.details?.placeId);
      const workers = 2;
      const next = async () => {
        while (!cancelled) {
          const s = queue.shift();
          if (!s) return;
          try {
            await fetchDeepDetails(s);
          } catch {
            // ignore
          }
        }
      };
      await Promise.all(Array.from({ length: workers }, () => next()));
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, activeDay, currentStops, fetchDeepDetails]);

  useEffect(() => {
    if (!expandedStop || !plan) return;
    const existing = deepDetailsRef.current[expandedStop.id];
    if (existing?.menuHighlights?.length || existing?.admission || existing?.fees || existing?.ticketingUrl) return;
    const website = expandedStop.details?.website ?? null;
    if (!website) return;
    let cancelled = false;
    setDeepBusy(true);
    (async () => {
      try {
        await fetchDeepDetails(expandedStop);
      } finally {
        if (!cancelled) setDeepBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedStop, plan, fetchDeepDetails]);

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
        `/api/trip/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&type=${
          form.accessibility.restStops ? "bathroom" : "lunch"
        }`,
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
  }, [selectedStopId, plan, currentStops, form.accessibility.restStops]);

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
          budgetAmount: form.budgetAmount,
          pace: form.pace,
          vibes: form.vibes,
          mustInclude: form.mustInclude,
          transport: form.transport,
          tripDate: form.tripDate || null,
          accessibility: form.accessibility,
        }),
      });
      const data = (await res.json()) as { error?: string; plan?: TripPlan; weather?: TripWeather | null };
      if (!res.ok) {
        setErr(data.error ?? "Plan failed");
        return;
      }
      if (data.plan) {
        setPlan(data.plan);
        setWeather(data.weather ?? null);
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
    setWeather(null);
    setActiveDay(1);
    setSelectedStopId(demoTripSanFrancisco.trip.days[0]!.stops[0]!.id);
    setExpandedStopId(null);
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
              weather={weather}
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
              onExpandStop={setExpandedStopId}
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
                  Blue dots: nearby {form.accessibility.restStops ? "rest stops (bathrooms)" : "places (search)"}.
                  Pick a stop on the map or list.
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
      {plan && expandedStop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandedStopId(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-4 text-parchment/90 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-parchment/50">Stop details</p>
                <h3 className="mt-1 text-xl font-serif text-parchment">{expandedStop.name}</h3>
                <p className="mt-1 text-sm text-parchment/60">{expandedStop.address}</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-parchment/80 hover:bg-white/10"
                onClick={() => setExpandedStopId(null)}
              >
                Collapse
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              {expandedStop.description?.trim() && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-parchment/50">Why go</p>
                  <p className="mt-1 text-parchment/80">{expandedStop.description}</p>
                </div>
              )}

              {deepBusy && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-parchment/60">
                  Fetching more details (hours, fees, menu highlights)…
                </div>
              )}
              {!deepBusy && expandedDeepHint && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100/80">
                  {expandedDeepHint}
                </div>
              )}

              {expandedMergedDetails && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-parchment/50">Extra info</p>
                  <div className="mt-2 space-y-1 text-parchment/80">
                    {expandedMergedDetails.cuisine && (
                      <p>
                        <span className="text-parchment/50">Cuisine:</span> {expandedMergedDetails.cuisine}
                      </p>
                    )}
                    {expandedMergedDetails.openingHoursText?.length ? (
                      <div>
                        <p className="text-parchment/50">Hours:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {expandedMergedDetails.openingHoursText.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {expandedMergedDetails.admission && (
                      <div>
                        <p className="text-parchment/50">Admission:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {expandedMergedDetails.admission.summary && <li>{expandedMergedDetails.admission.summary}</li>}
                          {expandedMergedDetails.admission.member && <li>Member: {expandedMergedDetails.admission.member}</li>}
                          {expandedMergedDetails.admission.adult && <li>Adult: {expandedMergedDetails.admission.adult}</li>}
                          {expandedMergedDetails.admission.student && <li>Student: {expandedMergedDetails.admission.student}</li>}
                          {expandedMergedDetails.admission.teen && <li>Teen: {expandedMergedDetails.admission.teen}</li>}
                          {expandedMergedDetails.admission.child && <li>Child: {expandedMergedDetails.admission.child}</li>}
                          {expandedMergedDetails.admission.senior && <li>Senior: {expandedMergedDetails.admission.senior}</li>}
                          {expandedMergedDetails.admission.freeDays && <li>Free days: {expandedMergedDetails.admission.freeDays}</li>}
                        </ul>
                      </div>
                    )}
                    {expandedMergedDetails.fees && (
                      <div>
                        <p className="text-parchment/50">Fees / permits:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {expandedMergedDetails.fees.entry && <li>Entry: {expandedMergedDetails.fees.entry}</li>}
                          {expandedMergedDetails.fees.parking && <li>Parking: {expandedMergedDetails.fees.parking}</li>}
                          {expandedMergedDetails.fees.permit && <li>Permit: {expandedMergedDetails.fees.permit}</li>}
                        </ul>
                      </div>
                    )}
                    {expandedMergedDetails.menuHighlights?.length ? (
                      <div>
                        <p className="text-parchment/50">Menu highlights:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {expandedMergedDetails.menuHighlights.slice(0, 10).map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {expandedMergedDetails.ticketingUrl && (
                      <p className="break-words">
                        <span className="text-parchment/50">Tickets:</span>{" "}
                        <a
                          className="text-ember/90 hover:underline"
                          href={expandedMergedDetails.ticketingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {expandedMergedDetails.ticketingUrl}
                        </a>
                      </p>
                    )}
                    {expandedMergedDetails.wheelchairAccessibleEntrance != null && (
                      <p>
                        <span className="text-parchment/50">Wheelchair entrance:</span>{" "}
                        {expandedMergedDetails.wheelchairAccessibleEntrance ? "Yes" : "No / unknown"}
                      </p>
                    )}
                    {expandedMergedDetails.website && (
                      <p className="break-words">
                        <span className="text-parchment/50">Website:</span>{" "}
                        <a
                          className="text-ember/90 hover:underline"
                          href={expandedMergedDetails.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {expandedMergedDetails.website}
                        </a>
                      </p>
                    )}
                    {expandedMergedDetails.phone && (
                      <p>
                        <span className="text-parchment/50">Phone:</span> {expandedMergedDetails.phone}
                      </p>
                    )}
                    {expandedMergedDetails.provider && (
                      <p className="text-[11px] text-parchment/40">
                        Source: {expandedMergedDetails.provider.toUpperCase()}
                        {expandedMergedDetails.deepSourceUrl ? ` · Deep: ${expandedMergedDetails.deepSourceUrl}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
