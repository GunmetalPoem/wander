"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultTripForm,
  demoTripSanFrancisco,
  type TripFormInput,
  type TripPlan,
} from "@/lib/trip-schema";
import { appendMustExclude, applyLastUserMessageTweaks, mergeTripChatPatch, type TripChatPatch } from "@/lib/trip-chat-merge";
import { removeStopFromDay, replaceDayStops } from "@/lib/trip-mutate";
import { scheduleDayStops, suggestedDayStartMinutes } from "@/lib/trip-time";
import { TripForm } from "./TripForm";
import { TripTimeline } from "./TripTimeline";
import { TripSummary } from "./TripSummary";
import { CityConfirmField } from "./CityConfirmField";
import { TripChatPanel, type TripChatMessage } from "./TripChatPanel";
import type { TripWeather } from "@/lib/weather";
import type { TripDay, TripStop } from "@/lib/trip-schema";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import type { PlanStreamEvent } from "@/lib/trip-plan-service";
import { AnimatePresence, easeOutQuart, motion, useReducedMotion } from "@/components/ui/Motion";
import Modal from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import Accordion from "@/components/ui/Accordion";
import SettingsPopover from "@/components/ui/SettingsPopover";
import ShaderBackground from "@/components/ui/ShaderBackground";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

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
    <motion.div
      className="flex w-full justify-center lg:h-[calc(100vh-5.5rem)]"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.32, ease: easeOutQuart }}
    >
      <section className="relative flex min-h-[min(72vh,680px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-coal via-void to-black lg:min-h-[calc(100vh-6rem)]">
        <ShaderBackground intensity="med" className="opacity-60" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_30%_20%,rgba(52,211,153,0.35),transparent_45%),radial-gradient(circle_at_80%_60%,rgba(255,255,255,0.12),transparent_40%)]" />
        <div className="relative flex min-h-[inherit] w-full flex-1 flex-col items-center justify-center gap-6 px-6 py-12">
          <motion.div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] shadow-lg shadow-black/40"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
          >
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-wander/25 border-t-wander" aria-hidden />
          </motion.div>
          <div className="flex w-full max-w-xl flex-col items-center text-center">
            <motion.h2
              className="font-serif text-2xl tracking-tight text-parchment sm:text-3xl"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4, ease: easeOutQuart }}
            >
              Building your itinerary
            </motion.h2>
            <motion.p
              className="mt-4 w-full text-balance text-center text-sm leading-relaxed text-parchment/55"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.18, duration: 0.4 }}
            >
              Laying out your days and stops on the map
              {cityLabel ? (
                <>
                  {" "}
                  for <span className="text-parchment/80">{cityLabel}</span>
                </>
              ) : null}
              …
            </motion.p>
          </div>
          <p className="text-center text-[11px] text-parchment/35">This usually takes a few seconds.</p>
        </div>
      </section>
    </motion.div>
  );
}

const WELCOME_MESSAGES: TripChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "I'm Wander. Tell me where you're going, how long you'll be there, and what you like to do — food, museums, outdoors, pace, budget, and so on. When the trip is clear enough I'll refresh the map automatically; you can also tap Build itinerary or Update trip next to Send. Remove stops from the timeline anytime (trash icon); those names stay on your “never include” list for the next rebuild, and you can ask me in chat to drop places too. New trip clears everything and starts over.",
  },
];

export function TripPlannerClient() {
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [creatingRoom, setCreatingRoom] = useState(false);
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
    // Reset to a clean slate for the new build; streaming events fill it in.
    setPlan(null);
    setWeather(null);
    setRouteFeature(null);
    setLegs([]);
    setNearby([]);

    type StopPatch = Partial<TripStop> & { id: string };

    const draftRef: {
      city: string;
      cityCenter?: { lat: number; lng: number };
      days: Map<number, TripDay>;
    } = {
      city: f.city,
      cityCenter: f.cityCenter ?? undefined,
      days: new Map(),
    };

    const commitDraft = () => {
      if (draftRef.days.size === 0) return;
      const ordered = [...draftRef.days.values()].sort((a, b) => a.day - b.day);
      setPlan({
        trip: {
          city: draftRef.city,
          city_center: draftRef.cityCenter,
          days: ordered,
        },
      } as TripPlan);
    };

    const applyStopPatches = (dayNum: number, patches: StopPatch[]) => {
      const d = draftRef.days.get(dayNum);
      if (!d) return;
      const byId = new Map(patches.map((p) => [p.id, p] as const));
      const nextStops = d.stops.map((s) => {
        const patch = byId.get(s.id);
        return patch ? ({ ...s, ...patch, details: { ...(s.details ?? {}), ...(patch.details ?? {}) } } as TripStop) : s;
      });
      draftRef.days.set(dayNum, { ...d, stops: nextStops });
      commitDraft();
    };

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
          mustExclude: f.mustExclude,
          transport: f.transport,
          tripDate: f.tripDate || null,
          accessibility: f.accessibility,
        }),
      });
      const ctype = res.headers.get("content-type") ?? "";
      if (!res.ok && !ctype.includes("ndjson")) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? `Plan failed (${res.status})`);
        return;
      }
      if (!ctype.includes("ndjson")) {
        // Backwards-compat fallback (older deploy returning one-shot JSON).
        const data = (await res.json()) as { plan?: TripPlan; weather?: TripWeather | null; error?: string };
        if (data.error) {
          setErr(data.error);
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
        return;
      }

      for await (const evUnknown of readNdjsonStream(res)) {
        const ev = evUnknown as PlanStreamEvent;
        switch (ev.type) {
          case "started":
            break;
          case "city":
            draftRef.city = ev.city ?? draftRef.city;
            if (ev.city_center) draftRef.cityCenter = ev.city_center;
            commitDraft();
            break;
          case "day": {
            draftRef.days.set(ev.day.day, ev.day);
            commitDraft();
            // Auto-focus first day + first stop the moment it arrives.
            if (draftRef.days.size === 1) {
              setActiveDay(ev.day.day);
              setSelectedStopId(ev.day.stops[0]?.id ?? null);
              setItinerarySuggested(false);
              setAwaitingCityForPlan(false);
            }
            break;
          }
          case "stops_located":
            applyStopPatches(ev.day, ev.stops as StopPatch[]);
            break;
          case "stops_enriched":
            applyStopPatches(ev.day, ev.stops as StopPatch[]);
            break;
          case "weather":
            setWeather(ev.weather ?? null);
            break;
          case "complete":
            // Canonical final plan — replaces our optimistic state.
            setPlan(ev.plan);
            setActiveDay(1);
            setSelectedStopId(ev.plan.trip.days[0]?.stops[0]?.id ?? null);
            setItinerarySuggested(false);
            setAwaitingCityForPlan(false);
            break;
          case "error":
            setErr(ev.error || "Plan failed");
            break;
        }
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

  const shareWithGroup = useCallback(async () => {
    if (creatingRoom) return;
    setCreatingRoom(true);
    setErr(null);
    try {
      const res = await fetch("/api/trip/room", { method: "POST" });
      if (!res.ok) {
        setErr("Could not create group room. Try again.");
        return;
      }
      const j = (await res.json()) as { id: string; joinUrl: string };
      router.push(j.joinUrl);
    } catch {
      setErr("Network error creating group room.");
    } finally {
      setCreatingRoom(false);
    }
  }, [creatingRoom, router]);

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

  const onDeleteStop = useCallback(
    (stopId: string) => {
      if (!plan) return;
      const name = currentStops.find((s) => s.id === stopId)?.name ?? "this stop";
      if (!window.confirm(`Remove “${name}” from day ${activeDay}? It will stay on your “never include” list for the next AI rebuild.`)) return;
      const nextPlan = removeStopFromDay(plan, activeDay, stopId);
      setPlan(nextPlan);
      setForm((f) => ({ ...f, mustExclude: appendMustExclude(f.mustExclude, name) }));
      const remaining = nextPlan.trip.days.find((d) => d.day === activeDay)?.stops ?? [];
      setSelectedStopId((id) => {
        if (id !== stopId) return id;
        return remaining[0]?.id ?? null;
      });
      if (expandedStopId === stopId) setExpandedStopId(null);
    },
    [plan, activeDay, currentStops, expandedStopId],
  );

  const extraMarkers = useMemo(
    () => nearby.map((n) => ({ id: n.id, name: n.name, lat: n.lat, lng: n.lng, color: "#60a5fa" })),
    [nearby],
  );

  const buildLabel = plan ? "Update trip" : "Build itinerary";
  const buildDisabled = (!plan && !form.cityLocationReady) || busy || chatBusy;
  const buildHighlighted = itinerarySuggested && !busy;

  const showPlanProgressShell = busy && !plan;

  const copyTripJson = useCallback(() => {
    if (!plan) return;
    void navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
    toast.success("Trip JSON copied");
  }, [plan, toast]);

  const handleShareGroup = useCallback(async () => {
    try {
      await shareWithGroup();
    } catch {
      toast.error("Could not create group room. Try again.");
    }
  }, [shareWithGroup, toast]);

  const settingsContent = (close: () => void) => (
    <div className="p-3.5">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-parchment/40">Mode</p>
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-[11px]">
        <span className="rounded-full bg-wander px-3 py-1 font-semibold text-ink">Solo</span>
        <button
          type="button"
          onClick={() => {
            close();
            void handleShareGroup();
          }}
          disabled={creatingRoom}
          className="rounded-full px-3 py-1 text-parchment/70 transition-colors hover:bg-white/[0.05] hover:text-parchment disabled:opacity-50"
          title="Create a group trip room and invite friends"
        >
          {creatingRoom ? "Creating…" : "Group"}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-parchment/45">Plan together with a shared link.</p>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-parchment/40">Trip controls</p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              close();
              setManualFieldsOpen(true);
            }}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12px] text-parchment/85 transition-colors hover:border-wander/30 hover:bg-wander-muted"
          >
            All trip fields…
          </button>
          {plan ? (
            <button
              type="button"
              onClick={() => {
                close();
                copyTripJson();
              }}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12px] text-parchment/85 transition-colors hover:border-wander/30 hover:bg-wander-muted"
            >
              Copy trip JSON
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              close();
              startFreshTrip();
            }}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12px] text-parchment/85 transition-colors hover:border-red-500/30 hover:bg-red-500/10"
          >
            New trip
          </button>
        </div>
      </div>

      {!plan && !busy && !chatBusy ? (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] leading-snug text-parchment/40">
          Needs <code className="text-parchment/55">ANTHROPIC_API_KEY</code> or{" "}
          <code className="text-parchment/55">OPENAI_API_KEY</code>. Use “All trip fields” → Load SF demo to try the flow.
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="relative left-1/2 min-w-0 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-clip px-3 sm:px-5 lg:px-8">
      <AnimatePresence mode="wait" initial={false}>
        {showPlanProgressShell ? (
          <motion.div key="loading" className="w-full">
            <TripPlanningLoadingView cityLabel={form.city} />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: easeOutQuart }}
            className={`flex w-full min-w-0 flex-col gap-4 lg:h-[calc(100vh-5.5rem)] ${
              plan ? "lg:flex-row lg:items-stretch lg:gap-5" : ""
            }`}
          >
            <section
              className={`relative order-1 flex min-h-0 w-full min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-y-contain ${
                plan
                  ? "lg:order-1 lg:max-h-full lg:flex-[1.15_1_0] lg:min-w-[min(100%,420px)] lg:max-w-none"
                  : "lg:mx-auto lg:max-w-2xl lg:py-4 lg:justify-center"
              }`}
            >
              <motion.div
                layout
                className={`relative z-10 flex flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-black/40 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl ${
                  plan
                    ? "min-h-[460px] shrink-0 lg:h-[60vh] lg:min-h-[460px] lg:max-h-[680px]"
                    : "min-h-[320px]"
                }`}
              >
                <ShaderBackground
                  intensity={plan ? "low" : "med"}
                  className={plan ? "opacity-30" : "opacity-80"}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 [border-radius:inherit] bg-gradient-to-b from-black/10 via-transparent to-black/40"
                />


                <div className="absolute right-3 top-3 z-20">
                  <SettingsPopover
                    trigger={({ toggle, open }) => (
                      <Button
                        variant="icon"
                        size="sm"
                        aria-label="Settings"
                        aria-expanded={open}
                        onClick={toggle}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.86.97 1.51 1.85 1.51H21a2 2 0 1 1 0 4h-.09c-.88 0-1.49.65-1.51 1.49Z" />
                        </svg>
                      </Button>
                    )}
                  >
                    {({ close }) => settingsContent(close)}
                  </SettingsPopover>
                </div>

                <div className={`relative z-10 flex min-h-0 flex-1 flex-col ${plan ? "pr-10" : ""}`}>
                  <TripChatPanel
                    messages={chatMessages}
                    onSend={handleChatSend}
                    busy={chatBusy}
                    canType={!chatBusy}
                    variant={plan ? "compact" : "hero"}
                    onBuildItinerary={buildItinerary}
                    buildDisabled={buildDisabled}
                    buildBusy={busy}
                    buildLabel={buildLabel}
                    buildHighlighted={buildHighlighted}
                    onNewTrip={startFreshTrip}
                    sendError={err}
                    onClearSendError={() => setErr(null)}
                  />

                  <motion.div layout className="mt-3 border-t border-white/[0.06] pt-3">
                    <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-parchment/40">Where</p>
                    <CityConfirmField value={form} onChange={setForm} />
                  </motion.div>

                  <AnimatePresence>
                    {itinerarySuggested && !plan ? (
                      <motion.div
                        initial={{ opacity: 0, y: 6, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -4, height: 0 }}
                        transition={{ duration: 0.26, ease: easeOutQuart }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 rounded-xl border border-wander/30 bg-wander-muted px-3 py-2.5 text-center text-[11px] leading-snug text-parchment/90">
                          {form.cityLocationReady ? (
                            <>Enough detail — tap Build next to Send, or Wander will refresh the map when ready.</>
                          ) : (
                            <>Confirm the Where line above, then use Build next to Send.</>
                          )}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {awaitingCityForPlan && !form.cityLocationReady ? (
                    <p className="mt-2 text-[10px] text-wander/80">Pick the city in Where first.</p>
                  ) : null}
                </div>
              </motion.div>

              {plan ? (
                <motion.div
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: easeOutQuart, delay: 0.08 }}
                  className="flex flex-col gap-3"
                >
                  <TripSummary
                    plan={plan}
                    weather={weather}
                    activeDay={activeDay}
                    totalWalkMinutes={totalWalkMinutes}
                    totalDistanceKm={totalDistanceKm}
                    stopCount={currentStops.length}
                  />
                  <h3 className="text-xs uppercase tracking-[0.18em] text-parchment/45">Timeline</h3>
                  <TripTimeline
                    dayNumbers={dayNumbers}
                    activeDay={activeDay}
                    onDayChange={setActiveDay}
                    scheduled={scheduled}
                    onReorder={onReorder}
                    selectedStopId={selectedStopId}
                    onSelectStop={setSelectedStopId}
                    onExpandStop={setExpandedStopId}
                    onDeleteStop={onDeleteStop}
                    mapboxAccessToken={mapboxToken}
                    isRefreshing={busy && !!plan}
                  />
                  {selectedStopId ? (
                    <p className="text-[10px] text-parchment/45">
                      Blue dots: nearby {form.accessibility.restStops ? "rest stops (bathrooms)" : "places (search)"}.
                    </p>
                  ) : null}
                </motion.div>
              ) : null}
            </section>

            {plan ? (
              <motion.section
                key="map"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.42, ease: easeOutQuart, delay: 0.05 }}
                className="order-2 relative h-[42vh] min-h-[280px] w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-white/10 lg:h-auto lg:min-h-0 lg:flex-[1.35_1_0] lg:min-w-[min(100%,360px)]"
              >
                <TripMap
                  mapboxToken={mapboxToken}
                  plan={plan}
                  activeDay={activeDay}
                  selectedStopId={selectedStopId}
                  onSelectStop={setSelectedStopId}
                  routeFeature={routeFeature}
                  extraMarkers={extraMarkers}
                />
                <AnimatePresence>
                  {busy ? (
                    <motion.div
                      key="map-busy"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-end gap-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent pb-6 pt-16"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <div className="flex items-center gap-2 rounded-full border border-wander/25 bg-black/70 px-3 py-1.5 shadow-lg backdrop-blur-sm">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-wander/25 border-t-wander" />
                        <span className="text-[11px] font-medium text-parchment/95">Updating map &amp; stops…</span>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.section>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={manualFieldsOpen}
        onClose={() => setManualFieldsOpen(false)}
        labelledBy="manual-trip-fields-title"
        widthClass="max-w-lg"
      >
        <div className="max-h-[min(88vh,720px)] overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 id="manual-trip-fields-title" className="font-serif text-lg text-parchment">
                Trip fields
              </h2>
              <p className="mt-0.5 text-[11px] text-parchment/45">
                Optional — chat usually fills these. Escape to close.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setManualFieldsOpen(false)}>
              Close
            </Button>
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
      </Modal>

      <Drawer
        open={Boolean(plan && expandedStop)}
        onClose={() => setExpandedStopId(null)}
        widthClass="max-w-md"
        labelledBy="stop-details-title"
      >
        {expandedStop ? (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.18em] text-parchment/45">Stop details</p>
                <h3 id="stop-details-title" className="mt-1 truncate text-lg font-serif text-parchment">
                  {expandedStop.name}
                </h3>
                <p className="mt-0.5 truncate text-xs text-parchment/55">{expandedStop.address}</p>
              </div>
              <Button
                variant="icon"
                size="sm"
                aria-label="Close details"
                onClick={() => setExpandedStopId(null)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </Button>
            </div>

            <div className="wander-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-5 text-sm text-parchment/85">
              {expandedStop.description?.trim() ? (
                <div className="rounded-xl border border-white/8 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-parchment/45">Why go</p>
                  <p className="mt-1 leading-relaxed text-parchment/85">{expandedStop.description}</p>
                </div>
              ) : null}

              {expandedMergedDetails?.cuisine || expandedMergedDetails?.openingHoursText?.length ? (
                <div className="rounded-xl border border-white/8 bg-black/25 p-3 text-[12px] text-parchment/80 space-y-1">
                  {expandedMergedDetails.cuisine ? (
                    <p>
                      <span className="text-parchment/45">Cuisine:</span> {expandedMergedDetails.cuisine}
                    </p>
                  ) : null}
                  {expandedMergedDetails.openingHoursText?.length ? (
                    <p>
                      <span className="text-parchment/45">Open:</span>{" "}
                      {expandedMergedDetails.openingHoursText[0]}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <AnimatePresence>
                {deepBusy ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="rounded-xl border border-white/8 bg-black/25 p-3 text-xs text-parchment/55"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-wander/30 border-t-wander" />
                      Fetching more details (hours, fees, menu highlights)…
                    </span>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {!deepBusy && expandedDeepHint ? (
                <div className="rounded-xl border border-wander/25 bg-wander-muted p-3 text-xs text-parchment/80">
                  {expandedDeepHint}
                </div>
              ) : null}

              {expandedMergedDetails?.admission ? (
                <Accordion title="Admission">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {expandedMergedDetails.admission.summary && <li>{expandedMergedDetails.admission.summary}</li>}
                    {expandedMergedDetails.admission.member && <li>Member: {expandedMergedDetails.admission.member}</li>}
                    {expandedMergedDetails.admission.adult && <li>Adult: {expandedMergedDetails.admission.adult}</li>}
                    {expandedMergedDetails.admission.student && <li>Student: {expandedMergedDetails.admission.student}</li>}
                    {expandedMergedDetails.admission.teen && <li>Teen: {expandedMergedDetails.admission.teen}</li>}
                    {expandedMergedDetails.admission.child && <li>Child: {expandedMergedDetails.admission.child}</li>}
                    {expandedMergedDetails.admission.senior && <li>Senior: {expandedMergedDetails.admission.senior}</li>}
                    {expandedMergedDetails.admission.freeDays && <li>Free days: {expandedMergedDetails.admission.freeDays}</li>}
                  </ul>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.fees ? (
                <Accordion title="Fees & permits">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {expandedMergedDetails.fees.entry && <li>Entry: {expandedMergedDetails.fees.entry}</li>}
                    {expandedMergedDetails.fees.parking && <li>Parking: {expandedMergedDetails.fees.parking}</li>}
                    {expandedMergedDetails.fees.permit && <li>Permit: {expandedMergedDetails.fees.permit}</li>}
                  </ul>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.menuHighlights?.length ? (
                <Accordion title="Menu highlights">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {expandedMergedDetails.menuHighlights.slice(0, 10).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.openingHoursText?.length ? (
                <Accordion title="Hours (full)">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {expandedMergedDetails.openingHoursText.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.wheelchairAccessibleEntrance != null ? (
                <Accordion title="Wheelchair access">
                  <p>
                    Entrance:{" "}
                    {expandedMergedDetails.wheelchairAccessibleEntrance ? "Yes" : "No / unknown"}
                  </p>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.ticketingUrl ? (
                <Accordion title="Ticketing">
                  <a
                    className="break-all text-wander/90 hover:underline"
                    href={expandedMergedDetails.ticketingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {expandedMergedDetails.ticketingUrl}
                  </a>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.website ? (
                <Accordion title="Website">
                  <a
                    className="break-all text-wander/90 hover:underline"
                    href={expandedMergedDetails.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {expandedMergedDetails.website}
                  </a>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.phone ? (
                <Accordion title="Phone">
                  <p>{expandedMergedDetails.phone}</p>
                </Accordion>
              ) : null}

              {expandedMergedDetails?.provider ? (
                <p className="pt-2 text-[10px] text-parchment/40">
                  Source: {expandedMergedDetails.provider.toUpperCase()}
                  {expandedMergedDetails.deepSourceUrl ? ` · Deep: ${expandedMergedDetails.deepSourceUrl}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
