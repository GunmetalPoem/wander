"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TripChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const SUGGESTIONS = [
  "3 days in Lisbon, foodie pace, ~$200/day walking",
  "Family weekend in Chicago, low walking, April 12–14",
  "Solo Tokyo — photography and hidden gems, 5 days",
];

type Props = {
  messages: TripChatMessage[];
  onSend: (text: string) => Promise<void>;
  busy: boolean;
  /** When false, textarea / Send / chips are locked (trip chat API in flight — not itinerary build). */
  canType: boolean;
  variant?: "hero" | "compact";
  /** Shown beside Send — generates / refreshes the itinerary from current fields. */
  onBuildItinerary?: () => void;
  buildDisabled?: boolean;
  buildBusy?: boolean;
  buildLabel?: string;
  /** Emphasize Build when the model signaled readiness. */
  buildHighlighted?: boolean;
  /** Start over: clear plan and chat (parent handles). */
  onNewTrip?: () => void;
  /** Inline error message displayed above the textarea (e.g. send failure). */
  sendError?: string | null;
  onClearSendError?: () => void;
};

export function TripChatPanel({
  messages,
  onSend,
  busy,
  canType,
  variant = "hero",
  onBuildItinerary,
  buildDisabled = false,
  buildBusy = false,
  buildLabel = "Build itinerary",
  buildHighlighted = false,
  onNewTrip,
  sendError = null,
  onClearSendError,
}: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const isHero = variant === "hero";

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const submit = useCallback(async () => {
    const t = draft.trim();
    if (!t || !canType) return;
    setDraft("");
    await onSend(t);
  }, [draft, canType, onSend]);

  return (
    <div className={`flex flex-col ${isHero ? "min-h-0 flex-1" : "border-b border-white/5 pb-3"}`}>
      {isHero && (
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent shadow-lg shadow-black/40">
            <span className="font-serif text-2xl text-parchment/95">W</span>
          </div>
          <h1 className="font-serif text-2xl tracking-tight text-parchment sm:text-3xl">Plan a trip, in conversation</h1>
          <p className="mt-2 max-w-md text-sm text-parchment/55">
            Describe your trip — I&apos;ll ask if I need dates, pace, budget, or anything else. Your map stays on the side once
            the plan loads so you can keep refining.
          </p>
        </div>
      )}

      {!isHero && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-widest text-parchment/45">Trip assistant</p>
          {onNewTrip ? (
            <button
              type="button"
              onClick={onNewTrip}
              disabled={buildBusy || !canType}
              className="text-[10px] text-parchment/45 underline-offset-2 hover:text-parchment hover:underline disabled:opacity-40"
            >
              New trip
            </button>
          ) : null}
        </div>
      )}

      <div
        ref={listRef}
        className={`mb-3 min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1 ${
          isHero
            ? "max-h-[min(52vh,520px)] flex-1 sm:max-h-[min(48vh,480px)]"
            : "max-h-[min(40vh,360px)] lg:max-h-[min(62vh,680px)]"
        }`}
      >
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] ${
                m.role === "user"
                  ? "bg-white/[0.08] text-parchment/95"
                  : "border border-white/[0.06] bg-black/25 text-parchment/85"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-wander/20 bg-wander-muted px-3.5 py-2 text-xs text-parchment/55">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {sendError ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          <span aria-hidden className="mt-0.5">!</span>
          <p className="flex-1 leading-snug">{sendError}</p>
          {onClearSendError ? (
            <button
              type="button"
              onClick={onClearSendError}
              className="ml-1 shrink-0 rounded px-1 text-red-200/70 hover:bg-red-500/20 hover:text-red-100"
              aria-label="Dismiss error"
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-2xl border border-white/[0.08] bg-black/35 p-1 shadow-inner shadow-black/20">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-2.5 py-1.5">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] text-parchment/45">
            <span className="text-wander/75" aria-hidden>
              ↯
            </span>
            <span className="truncate">Tips: dates, group size, budget per day, walking vs driving</span>
          </p>
          {isHero && onNewTrip ? (
            <button
              type="button"
              onClick={onNewTrip}
              disabled={buildBusy || !canType}
              className="shrink-0 text-[10px] text-parchment/45 underline-offset-2 hover:text-parchment hover:underline disabled:opacity-40"
            >
              New trip
            </button>
          ) : null}
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-wander/90">
            <span className="h-1.5 w-1.5 rounded-full bg-wander shadow-[0_0_8px_rgba(52,211,153,0.45)]" />
            Live
          </span>
        </div>
        <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-end">
          <textarea
            rows={2}
            className="min-h-[44px] w-full flex-1 resize-none rounded-xl border border-transparent bg-transparent px-2 py-2 text-sm text-parchment placeholder:text-parchment/35 outline-none focus:border-wander/30 focus:ring-0 disabled:opacity-50 sm:min-w-0"
            placeholder="Ask anything about your trip…"
            value={draft}
            disabled={!canType}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex w-full shrink-0 gap-2 sm:w-auto sm:justify-end">
            {onBuildItinerary ? (
              <button
                type="button"
                onClick={onBuildItinerary}
                disabled={buildDisabled || buildBusy}
                title={buildDisabled ? "Confirm city in Where below (first trip) or wait until chat finishes" : buildLabel}
                className={`min-h-[44px] flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition sm:flex-initial sm:min-w-[7.5rem] ${
                  buildDisabled
                    ? "cursor-not-allowed border-white/20 bg-white/[0.06] text-parchment/45"
                    : buildHighlighted
                      ? "border-wander/60 bg-wander text-ink ring-2 ring-wander/70 shadow-[0_0_20px_rgba(52,211,153,0.25)] hover:bg-wander/95"
                      : "border-white/15 bg-white/[0.08] text-parchment/90 hover:border-wander/40 hover:bg-wander-muted"
                } ${buildBusy ? "opacity-70" : ""}`}
              >
                {buildBusy ? "Building…" : buildLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!draft.trim() || !canType}
              className="min-h-[44px] flex-1 rounded-xl bg-wander/90 px-3 py-2 text-xs font-semibold text-ink shadow-md shadow-black/30 transition hover:bg-wander disabled:cursor-not-allowed disabled:opacity-40 sm:flex-initial sm:min-w-[4.5rem]"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={!canType}
            onClick={() => void onSend(s)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-[11px] text-parchment/70 transition hover:border-wander/30 hover:bg-wander-muted hover:text-parchment/90 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
