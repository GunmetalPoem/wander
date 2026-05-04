"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultTripForm,
  demoTripSanFrancisco,
  type TripFormInput,
  type TripPlan,
} from "@/lib/trip-schema";
import { applyLastUserMessageTweaks, mergeTripChatPatch, type TripChatPatch } from "@/lib/trip-chat-merge";
import { replaceDayStops } from "@/lib/trip-mutate";
import { scheduleDayStops, suggestedDayStartMinutes } from "@/lib/trip-time";
import { TripForm } from "./TripForm";
import { TripTimeline } from "./TripTimeline";
import { TripSummary } from "./TripSummary";
import { CityConfirmField } from "./CityConfirmField";
import { TripChatPanel, type TripChatMessage } from "./TripChatPanel";
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

function TripPlanningLoadingView({ cityLabel }: { cityLabel: string }) {
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-3 lg:h-[calc(100vh-5.5rem)] lg:flex-row lg:gap-4">
      <section className="relative order-1 flex min-h-[min(72vh,680px)] w-full flex-1 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-coal via-void to-black lg:order-2 lg:min-h-[calc(100vh-6rem)]">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_30%_20%,rgba(52,211,153,0.35),transparent_45%),radial-gradient(circle_at_80%_60%,rgba(255,255,255,0.12),transparent_40%)]" />
        <div className="relative flex h-full min-h-[inherit] flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] shadow-lg shadow-black/40">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-wander/25 border-t-wander" aria-hidden />
          </div>
          <div>
            <p className="font-serif text-2xl tracking-tight text-parchment sm:text-3xl">Building your itinerary</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-parchment/55">
              Laying out your days and stops on the map
              {cityLabel ? (
                <>
                  {" "}
                  for <span className="text-parchment/80">{cityLabel}</span>
                </>
              ) : null}
              …
            </p>
          </div>
          <p className="text-[11px] text-parchment/35">This usually takes a few seconds.</p>
        </div>
      </section>
    </div>
  );
}

const WELCOME_MESSAGES: TripChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "I'm Wander. Tell me where you're going, how long you'll be there, and what you like to do — food, museums, outdoors, pace, budget, and so on. When the trip is clear enough I'll refresh the map automatically; you can also tap Build itinerary or Update trip next to Send. New trip clears everything and starts over.",
  },
];

export function TripPlannerClient() {
  const [form, setForm] = useState<TripFormInput>(defaultTripForm);
  const formRef = useRef(form);
  formRef.current = form;
  const [chatMessages, setChatMessages] = useState<TripChatMessage[]>(WELCOME_MESSAGES);
  const chatMsgsRef = useRef(chatMessages);
  chatMsgsRef.current = chatMessages;
  const [chatBusy, setChatBusy] = useState(false);
  /** Model asked to plan but city must be confirmed first — then we prompt for Build. */
  const [awaitingCityForPlan, setAwaitingCityForPlan] = useState(false);
  /** Model signaled enough detail — highlight Build itinerary (user still taps to generate). */
  const [itinerarySuggested, setItinerarySuggested] = useState(false);
  const [manualFieldsOpen, setManualFieldsOpen] = useState(false);
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
  const dayStart = useMemo(() => suggestedDayStartMinutes(currentStops), [currentStops]);
  const scheduled = useMemo(
    () => scheduleDayStops(currentStops, legSeconds, dayStart.hour, dayStart.minute),
    [currentStops, legSeconds, dayStart.hour, dayStart.minute],
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

  const runPlanFromForm = useCallback(async (f: TripFormInput) => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/trip/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: f.city,
          cityCenter: f.cityCenter,
          days: f.days,
          groupSize: f.groupSize,
          budgetAmount: f.budgetAmount,
          pace: f.pace,
          vibes: f.vibes,
          mustInclude: f.mustInclude,
          transport: f.transport,
          tripDate: f.tripDate || null,
          accessibility: f.accessibility,
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
        setItinerarySuggested(false);
        setAwaitingCityForPlan(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const buildItinerary = useCallback(() => {
    setItinerarySuggested(false);
    setAwaitingCityForPlan(false);
    void runPlanFromForm(formRef.current);
  }, [runPlanFromForm]);

  const onSubmit = useCallback(() => {
    buildItinerary();
  }, [buildItinerary]);

  useEffect(() => {
    if (!awaitingCityForPlan || plan) return;
    if (!form.cityLocationReady) return;
    setAwaitingCityForPlan(false);
    setItinerarySuggested(true);
  }, [awaitingCityForPlan, form.cityLocationReady, plan]);

  useEffect(() => {
    if (!manualFieldsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setManualFieldsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualFieldsOpen]);

  const handleChatSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const isExplicitBuildCmd =
        /^(build my (itinerary|trip|map)|generate (the )?(itinerary|plan)|show (me )?(my )?(the )?(map|itinerary|trip|plan)|create (the )?(itinerary|plan)|draw (the )?(map|itinerary))\s*\.?$/i.test(
          trimmed,
        ) || /^go ahead (and )?(build|plan|generate)\s*\.?$/i.test(trimmed);

      if (
        isExplicitBuildCmd &&
        formRef.current.cityLocationReady &&
        formRef.current.city.trim().length > 1
      ) {
        const userMsg: TripChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
        chatMsgsRef.current = [...chatMsgsRef.current, userMsg];
        setChatMessages([...chatMsgsRef.current]);
        await buildItinerary();
        return;
      }

      if (!isExplicitBuildCmd) {
        setItinerarySuggested(false);
      }

      const userMsg: TripChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
      const nextHistory = [...chatMsgsRef.current, userMsg];
      chatMsgsRef.current = nextHistory;
      setChatMessages(nextHistory);
      setChatBusy(true);
      setErr(null);
      try {
        const res = await fetch("/api/trip/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextHistory.map(({ role, content }) => ({ role, content })),
            draft: formRef.current,
            hasExistingPlan: Boolean(plan),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          reply?: string;
          readyToPlan?: boolean;
          planWhenCityReady?: boolean;
          patch?: TripChatPatch;
        };
        if (!res.ok) {
          setErr(data.error ?? "Chat failed");
          if (typeof data.reply === "string" && data.reply.trim()) {
            const asst: TripChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.reply.trim(),
            };
            chatMsgsRef.current = [...chatMsgsRef.current, asst];
            setChatMessages([...chatMsgsRef.current]);
          }
          return;
        }
        const merged = applyLastUserMessageTweaks(trimmed, mergeTripChatPatch(formRef.current, data.patch));
        setForm(merged);
        if (typeof data.reply === "string" && data.reply.trim()) {
          const asst: TripChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.reply.trim(),
          };
          chatMsgsRef.current = [...chatMsgsRef.current, asst];
          setChatMessages([...chatMsgsRef.current]);
        }

        if (data.readyToPlan === true || data.planWhenCityReady === true) {
          setItinerarySuggested(true);
        }
        if ((data.planWhenCityReady === true || data.readyToPlan === true) && !merged.cityLocationReady) {
          setAwaitingCityForPlan(true);
        } else {
          setAwaitingCityForPlan(false);
        }

        if ((data.readyToPlan === true || data.planWhenCityReady === true) && merged.cityLocationReady) {
          await runPlanFromForm(merged);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Request failed");
      } finally {
        setChatBusy(false);
      }
    },
    [runPlanFromForm, plan, buildItinerary],
  );

  const startFreshTrip = useCallback(() => {
    setPlan(null);
    setWeather(null);
    setRouteFeature(null);
    setLegs([]);
    setNearby([]);
    setErr(null);
    setItinerarySuggested(false);
    setAwaitingCityForPlan(false);
    setForm(defaultTripForm);
    setActiveDay(1);
    setSelectedStopId(null);
    setExpandedStopId(null);
    setDeepDetailsByStopId({});
    setDeepHintByStopId({});
    chatMsgsRef.current = [...WELCOME_MESSAGES];
    setChatMessages([...WELCOME_MESSAGES]);
  }, []);

  const onLoadDemo = useCallback(() => {
    setErr(null);
    setItinerarySuggested(false);
    setAwaitingCityForPlan(false);
    setForm({
      ...formRef.current,
      city: "San Francisco, California, United States",
      cityCenter: { lat: 37.7749, lng: -122.4194 },
      cityLocationReady: true,
    });
    setPlan(demoTripSanFrancisco);
    setWeather(null);
    setActiveDay(1);
    setSelectedStopId(demoTripSanFrancisco.trip.days[0]!.stops[0]!.id);
    setExpandedStopId(null);
    const note: TripChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Loaded the San Francisco demo — your map and timeline are on the right. You can still chat here to practice the flow.",
    };
    chatMsgsRef.current = [...chatMsgsRef.current, note];
    setChatMessages([...chatMsgsRef.current]);
  }, []);

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

  const buildLabel = plan ? "Update trip" : "Build itinerary";
  const buildDisabled = (!plan && !form.cityLocationReady) || busy || chatBusy;
  const buildHighlighted = itinerarySuggested && !busy;

  const showPlanProgressShell = busy && !plan;

  return (
    <div className="relative left-1/2 min-w-0 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-clip px-3 sm:px-5 lg:px-8">
      {showPlanProgressShell ? (
        <div className="w-full">
          <TripPlanningLoadingView cityLabel={form.city} />
          {err ? (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs text-red-200">
              {err}
            </p>
          ) : null}
        </div>
      ) : (
    <div
      className={`flex w-full min-w-0 flex-col gap-4 lg:h-[calc(100vh-5.5rem)] ${plan ? "lg:flex-row lg:items-stretch lg:gap-5" : ""}`}
    >
      <section
        className={`order-1 flex min-h-0 w-full min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-y-contain ${
          plan
            ? "lg:order-1 lg:max-h-full lg:flex-[1.15_1_0] lg:min-w-[min(100%,420px)] lg:max-w-none"
            : "lg:mx-auto lg:max-w-2xl lg:py-4"
        }`}
      >
        <div className="rounded-3xl border border-white/[0.08] bg-black/35 p-4 shadow-xl shadow-black/30">
          <TripChatPanel
            messages={chatMessages}
            onSend={handleChatSend}
            busy={chatBusy}
            canType={!busy}
            variant={plan ? "compact" : "hero"}
            onBuildItinerary={buildItinerary}
            buildDisabled={buildDisabled}
            buildBusy={busy}
            buildLabel={buildLabel}
            buildHighlighted={buildHighlighted}
            onNewTrip={startFreshTrip}
          />

          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="mb-1.5 text-[10px] uppercase tracking-widest text-parchment/40">Where</p>
            <CityConfirmField value={form} onChange={setForm} />
          </div>

          {itinerarySuggested && !plan ? (
            <div className="mt-3 rounded-xl border border-wander/30 bg-wander-muted px-3 py-2.5 text-center text-[11px] leading-snug text-parchment/90">
              {form.cityLocationReady ? (
                <>Enough detail — Build / Update next to Send, or Wander will refresh the map when ready.</>
              ) : (
                <>Confirm the Where line above, then use Build next to Send.</>
              )}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            {awaitingCityForPlan && !form.cityLocationReady ? (
              <span className="text-[10px] text-amber-200/90">Pick the city in Where first.</span>
            ) : null}
            <button
              type="button"
              onClick={() => setManualFieldsOpen(true)}
              className="text-[11px] text-parchment/50 underline-offset-2 hover:text-parchment hover:underline"
            >
              All trip fields…
            </button>
          </div>
        </div>

        {err && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>
        )}

        {manualFieldsOpen && (
          <div
            className="fixed inset-0 z-[45] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-trip-fields-title"
            onClick={() => setManualFieldsOpen(false)}
          >
            <div
              className="max-h-[min(88vh,720px)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-coal p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 id="manual-trip-fields-title" className="font-serif text-lg text-parchment">
                    Trip fields
                  </h2>
                  <p className="mt-0.5 text-[11px] text-parchment/45">Optional — chat usually fills these. Escape to close.</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-parchment/80 hover:bg-white/5"
                  onClick={() => setManualFieldsOpen(false)}
                >
                  Close
                </button>
              </div>
              <TripForm
                value={form}
                onChange={setForm}
                onSubmit={() => {
                  buildItinerary();
                  setManualFieldsOpen(false);
                }}
                onLoadDemo={() => {
                  onLoadDemo();
                  setManualFieldsOpen(false);
                }}
                busy={busy}
              />
            </div>
          </div>
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

        {!plan && !busy && !chatBusy && (
          <p className="text-center text-[11px] text-parchment/40">
            Needs <code className="text-parchment/55">ANTHROPIC_API_KEY</code> or <code className="text-parchment/55">OPENAI_API_KEY</code>
            . SF demo: <button type="button" className="text-wander/90 hover:underline" onClick={() => setManualFieldsOpen(true)}>All trip fields</button> → Load SF demo.
          </p>
        )}
      </section>

      {plan ? (
        <section className="order-2 relative h-[42vh] min-h-[280px] w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-white/10 lg:h-auto lg:min-h-0 lg:flex-[1.35_1_0] lg:min-w-[min(100%,360px)]">
          <TripMap
            mapboxToken={mapboxToken}
            plan={plan}
            activeDay={activeDay}
            selectedStopId={selectedStopId}
            onSelectStop={setSelectedStopId}
            routeFeature={routeFeature}
            extraMarkers={extraMarkers}
          />
        </section>
      ) : null}
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
      )}
    </div>
  );
}
