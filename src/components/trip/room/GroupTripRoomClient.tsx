"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TripFormInput, TripPlan } from "@/lib/trip-schema";
import type { TripWeather } from "@/lib/weather";
import type { TripChatPatch } from "@/lib/trip-chat-merge";
import type { ConflictReport } from "@/lib/room-unified-draft";
import { scheduleDayStops, suggestedDayStartMinutes, type ScheduledStop } from "@/lib/trip-time";
import { WanderIcon } from "@/components/WanderIcon";
import { RoomTopBar } from "./RoomTopBar";
import { RoomJoinModal } from "./RoomJoinModal";
import {
  AnimatePresence,
  easeOutQuart,
  motion,
  slideUp,
  springSoft,
  staggerChildren,
  useReducedMotion,
} from "@/components/ui/Motion";
import MessageBubble from "@/components/ui/MessageBubble";
import Button from "@/components/ui/Button";
import Accordion from "@/components/ui/Accordion";
import SettingsPopover from "@/components/ui/SettingsPopover";
import ShaderBackground from "@/components/ui/ShaderBackground";
import { useToast } from "@/components/ui/Toast";

const TripMap = dynamic(() => import("@/components/trip/TripMap").then((m) => m.TripMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center rounded-2xl border border-white/10 bg-black/30 text-xs text-parchment/45">
      Loading map…
    </div>
  ),
});
const TripTimeline = dynamic(() => import("@/components/trip/TripTimeline").then((m) => m.TripTimeline), {
  ssr: false,
});
const TripSummary = dynamic(() => import("@/components/trip/TripSummary").then((m) => m.TripSummary), {
  ssr: false,
});

type Participant = {
  id: string;
  displayName: string;
  colorHex: string;
  lastSeenAt: number;
};

type RoomMessage = {
  id: string;
  participantId: string | null;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type RoomSnapshot = {
  room: { id: string; createdAt: number; expiresAt: number };
  participants: Participant[];
  messages: RoomMessage[];
  prefsByParticipant: Record<string, { values: TripChatPatch; touched: string[] }>;
  unifiedDraft: TripFormInput;
  conflicts: ConflictReport[];
  plan: TripPlan | null;
  planWeather: TripWeather | null;
  planBuiltAt: number | null;
  buildInProgress: boolean;
  buildLockBy: string | null;
  pendingAiCount: number;
  serverTime: number;
};

type Props = {
  roomId: string;
  initialSnapshot: RoomSnapshot;
  initialMeId: string | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function summarizeDraft(d: TripFormInput): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (d.city) out.push({ key: "city", label: d.city });
  out.push({ key: "days", label: `${d.days}d` });
  out.push({ key: "budgetAmount", label: `$${Math.round(d.budgetAmount)}/d` });
  out.push({ key: "pace", label: d.pace });
  out.push({ key: "transport", label: d.transport });
  if (d.vibes.length) {
    out.push({ key: "vibes", label: d.vibes.slice(0, 3).join(", ") + (d.vibes.length > 3 ? "…" : "") });
  }
  if (d.tripDate) out.push({ key: "tripDate", label: d.tripDate });
  if (d.mustExclude) out.push({ key: "mustExclude", label: `skip: ${d.mustExclude.slice(0, 24)}${d.mustExclude.length > 24 ? "…" : ""}` });
  return out;
}

export function GroupTripRoomClient({ roomId, initialSnapshot, initialMeId }: Props) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [snap, setSnap] = useState<RoomSnapshot>({
    ...initialSnapshot,
    pendingAiCount: initialSnapshot.pendingAiCount ?? 0,
  });
  const [meId, setMeId] = useState<string | null>(initialMeId);
  const [buildBusy, setBuildBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [activeDay, setActiveDay] = useState(1);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  const setError = useCallback(
    (msg: string | null) => {
      if (msg) toast.error(msg);
    },
    [toast],
  );

  const sinceRef = useRef<number>(initialSnapshot.serverTime);
  const messageIdsRef = useRef<Set<string>>(new Set(initialSnapshot.messages.map((m) => m.id)));
  const failuresRef = useRef<number>(0);
  const allMessagesRef = useRef<RoomMessage[]>(initialSnapshot.messages);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const mergeSnapshot = useCallback((next: RoomSnapshot, replaceMessages = false) => {
    let combined: RoomMessage[];
    if (replaceMessages) {
      combined = next.messages.slice();
      messageIdsRef.current = new Set(combined.map((m) => m.id));
    } else {
      const newMsgs: RoomMessage[] = [];
      for (const m of next.messages) {
        if (messageIdsRef.current.has(m.id)) continue;
        messageIdsRef.current.add(m.id);
        newMsgs.push(m);
      }
      combined = [...allMessagesRef.current, ...newMsgs].sort((a, b) => a.createdAt - b.createdAt);
    }
    allMessagesRef.current = combined;
    sinceRef.current = next.serverTime;
    setSnap({ ...next, messages: combined });
  }, []);

  // Polling loop — pace is faster (2s) when there's AI backlog so the build button responds quickly.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/trip/room/${roomId}?since=${sinceRef.current}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          failuresRef.current += 1;
          if (res.status === 410) setError("This room has expired.");
        } else {
          failuresRef.current = 0;
          const j = (await res.json()) as RoomSnapshot;
          mergeSnapshot(j);
        }
      } catch {
        failuresRef.current += 1;
      }
      const delay =
        failuresRef.current >= 3 ? 10_000 : snap.pendingAiCount > 0 ? 2_000 : 3_000;
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, 2500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, mergeSnapshot, snap.pendingAiCount, setError]);

  // Auto-scroll chat to bottom on new messages — only when user is already near the bottom.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (near) {
      el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    }
  }, [snap.messages.length, reduce]);

  const onJoined = useCallback((p: { id: string; displayName: string; colorHex: string }) => {
    setMeId(p.id);
    sinceRef.current = 0;
  }, []);

  const me = useMemo(
    () => (meId ? snap.participants.find((p) => p.id === meId) ?? null : null),
    [meId, snap.participants],
  );

  const participantsById = useMemo(() => {
    const map: Record<string, { displayName: string; colorHex: string }> = {};
    for (const p of snap.participants) map[p.id] = { displayName: p.displayName, colorHex: p.colorHex };
    return map;
  }, [snap.participants]);

  // Fire-and-forget send: optimistic insert, no spinner, no awaiting AI.
  const sendMessage = useCallback(
    (text: string) => {
      if (!me) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      setDraft("");

      // Optimistic local message — server will replace via snapshot when it returns.
      const localId = `local_${crypto.randomUUID()}`;
      const optimistic: RoomMessage = {
        id: localId,
        participantId: me.id,
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      messageIdsRef.current.add(localId);
      allMessagesRef.current = [...allMessagesRef.current, optimistic];
      setSnap((s) => ({
        ...s,
        messages: allMessagesRef.current,
        pendingAiCount: s.pendingAiCount + 1,
      }));

      void (async () => {
        try {
          const res = await fetch(`/api/trip/room/${roomId}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: trimmed }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            setError(j.error ?? `Send failed (${res.status})`);
            // Roll back optimistic insert.
            messageIdsRef.current.delete(localId);
            allMessagesRef.current = allMessagesRef.current.filter((m) => m.id !== localId);
            setSnap((s) => ({
              ...s,
              messages: allMessagesRef.current,
              pendingAiCount: Math.max(0, s.pendingAiCount - 1),
            }));
            return;
          }
          const j = (await res.json()) as RoomSnapshot;
          // Drop the optimistic placeholder; the server-side message will arrive via snapshot.
          messageIdsRef.current.delete(localId);
          allMessagesRef.current = allMessagesRef.current.filter((m) => m.id !== localId);
          mergeSnapshot(j, true);
        } catch {
          setError("Network error — message not sent.");
          messageIdsRef.current.delete(localId);
          allMessagesRef.current = allMessagesRef.current.filter((m) => m.id !== localId);
          setSnap((s) => ({
            ...s,
            messages: allMessagesRef.current,
            pendingAiCount: Math.max(0, s.pendingAiCount - 1),
          }));
        }
      })();
    },
    [me, roomId, mergeSnapshot, setError],
  );

  const onBuild = useCallback(async () => {
    if (buildBusy) return;
    setBuildBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trip/room/${roomId}/build`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; by?: string };
        if (j.error === "build_in_progress") {
          setError(`${j.by ?? "Someone"} is already building. Hold on a moment…`);
        } else {
          setError(j.error ?? `Build failed (${res.status})`);
        }
        return;
      }
      sinceRef.current = 0;
    } catch {
      setError("Network error — could not build.");
    } finally {
      setBuildBusy(false);
    }
  }, [roomId, buildBusy, setError]);

  // Plan rendering helpers.
  const plan = snap.plan;
  const dayNumbers = useMemo(() => (plan ? plan.trip.days.map((d) => d.day) : []), [plan]);
  useEffect(() => {
    if (plan && !dayNumbers.includes(activeDay)) {
      setActiveDay(dayNumbers[0] ?? 1);
    }
  }, [plan, dayNumbers, activeDay]);

  const scheduled: ScheduledStop[] = useMemo(() => {
    if (!plan) return [];
    const day = plan.trip.days.find((d) => d.day === activeDay);
    if (!day) return [];
    const start = suggestedDayStartMinutes(day.stops);
    return scheduleDayStops(day.stops, [], start.hour, start.minute);
  }, [plan, activeDay]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  const conflictsByField = useMemo(() => {
    const m = new Map<string, ConflictReport>();
    for (const c of snap.conflicts) m.set(c.field, c);
    return m;
  }, [snap.conflicts]);

  const draftRows = summarizeDraft(snap.unifiedDraft);

  // Build button state.
  const cityReady = snap.unifiedDraft.city.trim().length > 0;
  const buildDisabled =
    !cityReady || buildBusy || snap.buildInProgress || snap.pendingAiCount > 0;
  let buildLabel = "Build itinerary";
  if (buildBusy) buildLabel = "Building…";
  else if (snap.buildInProgress) {
    const by = snap.buildLockBy ? participantsById[snap.buildLockBy]?.displayName ?? "Someone" : "Someone";
    buildLabel = `${by} is building…`;
  } else if (snap.pendingAiCount > 0) buildLabel = `Catching up (${snap.pendingAiCount})…`;
  else if (!cityReady) buildLabel = "Need a city first";

  const sendDisabled = !meId;

  const settingsContent = (close: () => void) => (
    <div className="p-3.5">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-parchment/40">Mode</p>
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-[11px]">
        <Link
          href="/"
          onClick={close}
          className="rounded-full px-3 py-1 text-parchment/70 transition-colors hover:bg-white/[0.05] hover:text-parchment"
        >
          Solo
        </Link>
        <span className="rounded-full bg-wander px-3 py-1 font-semibold text-ink">Group</span>
      </div>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-parchment/40">AI status</p>
        {snap.pendingAiCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-wander/30 bg-wander-muted/40 px-2.5 py-1 text-[11px] text-wander/95">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-wander" />
            Catching up · {snap.pendingAiCount}
          </span>
        ) : (
          <span className="text-[11px] text-parchment/55">Up to date</span>
        )}
      </div>

      {snap.planBuiltAt ? (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] text-parchment/40">
          Last built{" "}
          {new Date(snap.planBuiltAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-void text-parchment">
      <RoomTopBar roomId={roomId} participants={snap.participants} meId={meId} />

      <main className="flex-1">
        <div
          className={`mx-auto flex w-full max-w-[1400px] min-w-0 flex-col gap-4 px-4 py-4 lg:h-[calc(100vh-5.5rem)] ${
            plan ? "lg:flex-row lg:items-stretch lg:gap-5" : ""
          }`}
        >
          {/* Left: chat panel */}
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
                      aria-label="Room settings"
                      aria-expanded={open}
                      onClick={toggle}
                    >
                      <svg
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
                <AnimatePresence initial={false}>
                  {!plan ? (
                    <motion.div
                      key="hero"
                      initial="hidden"
                      animate="visible"
                      exit={{ opacity: 0, y: -8, height: 0 }}
                      variants={staggerChildren(0.04, 0.08)}
                      className="mb-4 flex flex-col items-center text-center"
                    >
                      <motion.div
                        variants={slideUp}
                        className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent shadow-lg shadow-black/40"
                      >
                        <WanderIcon size={28} strokeWidth={2.25} />
                      </motion.div>
                      <motion.h1
                        variants={slideUp}
                        className="font-serif text-xl tracking-tight text-parchment sm:text-2xl"
                      >
                        Plan together
                      </motion.h1>
                      <motion.p
                        variants={slideUp}
                        className="mt-1.5 max-w-md text-[12px] text-parchment/55"
                      >
                        Everyone with the link drops what they want into the chat. Wander merges it
                        on the side and Build unlocks when the AI has caught up.
                      </motion.p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {/* Chat list */}
                <div
                  ref={chatScrollRef}
                  className="wander-scroll mb-3 min-h-[200px] space-y-2 overflow-y-auto overscroll-contain pr-1 max-h-[min(52vh,520px)] lg:max-h-[min(48vh,480px)]"
                >
                  {snap.messages.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-parchment/40">
                      Be the first to say what you want from this trip.
                    </p>
                  ) : null}
                  <AnimatePresence initial={false}>
                    {snap.messages.map((m) => {
                      const author = m.participantId ? participantsById[m.participantId] : null;
                      const isMe = m.participantId === meId;
                      return (
                        <MessageBubble
                          key={m.id}
                          side={isMe ? "right" : "left"}
                          className="items-start gap-2"
                        >
                          {!isMe ? (
                            <span
                              aria-hidden
                              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-black/80"
                              style={{ background: author?.colorHex ?? "#888" }}
                            >
                              {initials(author?.displayName ?? "?")}
                            </span>
                          ) : null}
                          <div
                            className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                              isMe
                                ? "bg-wander-muted/70 text-parchment shadow-[0_8px_30px_-12px_rgba(52,211,153,0.45)]"
                                : "border border-white/[0.06] bg-black/30 text-parchment/90"
                            }`}
                          >
                            {!isMe && author ? (
                              <p
                                className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
                                style={{ color: author.colorHex }}
                              >
                                {author.displayName}
                              </p>
                            ) : null}
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                        </MessageBubble>
                      );
                    })}
                  </AnimatePresence>
                </div>

                {/* Composer */}
                <motion.div
                  layout
                  className="rounded-2xl border border-white/[0.08] bg-black/40 p-1 shadow-inner shadow-black/30 backdrop-blur-sm transition-colors focus-within:border-wander/30"
                >
                  <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-end">
                    <textarea
                      rows={2}
                      className="min-h-[44px] w-full flex-1 resize-none rounded-xl border border-transparent bg-transparent px-2 py-2 text-sm text-parchment placeholder:text-parchment/35 outline-none focus:border-transparent disabled:opacity-50 sm:min-w-0"
                      placeholder={sendDisabled ? "Joining…" : "Type what you want from this trip…"}
                      value={draft}
                      disabled={sendDisabled}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage(draft);
                        }
                      }}
                    />
                    <div className="flex w-full shrink-0 gap-2 sm:w-auto sm:justify-end">
                      <Button
                        variant={buildDisabled ? "ghost" : "primary"}
                        size="md"
                        onClick={onBuild}
                        disabled={buildDisabled}
                        loading={buildBusy}
                        shimmer={!buildDisabled && !buildBusy}
                        title={buildDisabled ? buildLabel : "Generate itinerary from the unified draft"}
                        className="flex-1 sm:flex-initial sm:min-w-[8.5rem]"
                      >
                        {buildLabel}
                      </Button>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => sendMessage(draft)}
                        disabled={!draft.trim() || sendDisabled}
                        className="flex-1 sm:flex-initial sm:min-w-[5rem]"
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                </motion.div>

                {/* Unified draft — collapsed under an accordion */}
                {draftRows.length > 0 ? (
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    <Accordion
                      defaultOpen={false}
                      title={
                        <span className="inline-flex items-center gap-2">
                          Trip status
                          {snap.conflicts.length > 0 ? (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                              {snap.conflicts.length} conflict{snap.conflicts.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </span>
                      }
                    >
                      <div className="flex flex-wrap gap-1.5">
                        {draftRows.map((r) => {
                          const c = conflictsByField.get(r.key);
                          return (
                            <motion.span
                              key={r.key}
                              layout
                              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={springSoft}
                              title={
                                c
                                  ? `conflict — ${c.values
                                      .map(
                                        (v) =>
                                          `${participantsById[v.participantId]?.displayName ?? "?"}: ${String(v.value)}`,
                                      )
                                      .join(" · ")}`
                                  : undefined
                              }
                              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                                c
                                  ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200"
                                  : "border-white/10 bg-white/[0.04] text-parchment/80"
                              }`}
                            >
                              {r.label}
                              {c ? " ⚠" : ""}
                            </motion.span>
                          );
                        })}
                      </div>
                    </Accordion>
                  </div>
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
                  weather={snap.planWeather}
                  activeDay={activeDay}
                  totalWalkMinutes={null}
                  totalDistanceKm={null}
                  stopCount={scheduled.length}
                />
                <h3 className="text-xs uppercase tracking-[0.18em] text-parchment/45">Timeline</h3>
                <TripTimeline
                  dayNumbers={dayNumbers}
                  activeDay={activeDay}
                  onDayChange={setActiveDay}
                  scheduled={scheduled}
                  onReorder={() => undefined}
                  selectedStopId={selectedStopId}
                  onSelectStop={setSelectedStopId}
                  onExpandStop={setSelectedStopId}
                  mapboxAccessToken={mapboxToken}
                />
              </motion.div>
            ) : null}
          </section>

          {/* Right: map */}
          <AnimatePresence>
            {plan ? (
              <motion.section
                key="room-map"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
                transition={{ duration: 0.42, ease: easeOutQuart, delay: 0.05 }}
                className="order-2 relative h-[42vh] min-h-[280px] w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-white/10 lg:h-auto lg:min-h-0 lg:flex-[1.35_1_0] lg:min-w-[min(100%,360px)]"
              >
                {mapboxToken ? (
                  <TripMap
                    mapboxToken={mapboxToken}
                    plan={plan}
                    activeDay={activeDay}
                    selectedStopId={selectedStopId}
                    onSelectStop={setSelectedStopId}
                    routeFeature={null}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-parchment/40">
                    Set NEXT_PUBLIC_MAPBOX_TOKEN to enable the map.
                  </div>
                )}
                <AnimatePresence>
                  {buildBusy ? (
                    <motion.div
                      key="build-busy"
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
                        <span className="text-[11px] font-medium text-parchment/95">
                          Building shared itinerary…
                        </span>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </div>
      </main>

      {!meId && <RoomJoinModal roomId={roomId} onJoined={onJoined} />}
    </div>
  );
}
