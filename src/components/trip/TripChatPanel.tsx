"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WanderIcon } from "@/components/WanderIcon";
import Button from "@/components/ui/Button";
import MessageBubble from "@/components/ui/MessageBubble";
import {
  AnimatePresence,
  motion,
  slideUp,
  springSoft,
  staggerChildren,
  useReducedMotion,
} from "@/components/ui/Motion";

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
  canType: boolean;
  variant?: "hero" | "compact";
  onBuildItinerary?: () => void;
  buildDisabled?: boolean;
  buildBusy?: boolean;
  buildLabel?: string;
  buildHighlighted?: boolean;
  onNewTrip?: () => void;
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
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Smooth scroll only when user is already near the bottom — avoid yanking
    // them away from older messages they're reading.
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (near) {
      el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    }
  }, [messages, busy, reduce]);

  const submit = useCallback(async () => {
    const t = draft.trim();
    if (!t || !canType) return;
    setDraft("");
    await onSend(t);
  }, [draft, canType, onSend]);

  return (
    <div className={`flex flex-col ${isHero ? "min-h-0 flex-1" : "min-h-0 flex-1"}`}>
      {isHero && (
        <motion.div
          className="mb-6 flex flex-col items-center text-center"
          initial="hidden"
          animate="visible"
          variants={staggerChildren(0.04, 0.08)}
        >
          <motion.div
            variants={slideUp}
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent shadow-lg shadow-black/40"
          >
            <WanderIcon size={32} strokeWidth={2.25} />
          </motion.div>
          <motion.h1
            variants={slideUp}
            className="font-serif text-2xl tracking-tight text-parchment sm:text-3xl"
          >
            Plan a trip, in conversation
          </motion.h1>
          <motion.p
            variants={slideUp}
            className="mt-2 max-w-md text-sm text-parchment/55"
          >
            Describe your trip — I&apos;ll ask if I need dates, pace, budget, or anything else. Your map appears on the side once the plan loads so you can keep refining.
          </motion.p>
        </motion.div>
      )}

      {!isHero && onNewTrip ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-parchment/40">Trip assistant</p>
          <button
            type="button"
            onClick={onNewTrip}
            disabled={buildBusy || !canType}
            className="text-[10px] text-parchment/45 underline-offset-2 transition-colors hover:text-parchment hover:underline disabled:opacity-40"
          >
            New trip
          </button>
        </div>
      ) : null}

      <div
        ref={listRef}
        className={`wander-scroll mb-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 ${
          isHero
            ? "max-h-[min(52vh,520px)] sm:max-h-[min(48vh,480px)]"
            : "min-h-[200px] max-h-[min(46vh,520px)] lg:max-h-[min(62vh,680px)]"
        }`}
      >
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <MessageBubble key={m.id} side={m.role === "user" ? "right" : "left"}>
              <div
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] transition-shadow duration-300 ${
                  m.role === "user"
                    ? "bg-wander-muted/70 text-parchment/95 shadow-[0_8px_30px_-12px_rgba(52,211,153,0.45)]"
                    : "border border-white/[0.06] bg-black/30 text-parchment/85"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </MessageBubble>
          ))}
          {busy ? (
            <MessageBubble key="__thinking" side="left">
              <div className="rounded-2xl border border-wander/25 bg-wander-muted px-3.5 py-2 text-xs text-parchment/65">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-wander animate-pulse-soft" />
                    <span className="h-1.5 w-1.5 rounded-full bg-wander animate-pulse-soft [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-wander animate-pulse-soft [animation-delay:240ms]" />
                  </span>
                  Thinking
                </span>
              </div>
            </MessageBubble>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {sendError ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={springSoft}
            className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
          >
            <span aria-hidden className="mt-0.5">!</span>
            <p className="flex-1 leading-snug">{sendError}</p>
            {onClearSendError ? (
              <button
                type="button"
                onClick={onClearSendError}
                className="ml-1 shrink-0 rounded px-1 text-red-200/70 transition-colors hover:bg-red-500/20 hover:text-red-100"
                aria-label="Dismiss error"
              >
                ×
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        layout
        className="rounded-2xl border border-white/[0.08] bg-black/40 p-1 shadow-inner shadow-black/30 backdrop-blur-sm transition-colors focus-within:border-wander/30"
      >
        <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-end">
          <textarea
            rows={2}
            className="min-h-[44px] w-full flex-1 resize-none rounded-xl border border-transparent bg-transparent px-2 py-2 text-sm text-parchment placeholder:text-parchment/35 outline-none focus:border-transparent focus:ring-0 disabled:opacity-50 sm:min-w-0"
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
              <Button
                size="md"
                variant={buildHighlighted ? "primary" : "ghost"}
                onClick={onBuildItinerary}
                disabled={buildDisabled || buildBusy}
                loading={buildBusy}
                shimmer={buildHighlighted && !buildBusy}
                title={
                  buildDisabled
                    ? "Confirm city in Where below (first trip) or wait until chat finishes"
                    : buildLabel
                }
                className="flex-1 sm:flex-initial sm:min-w-[8rem]"
              >
                {buildBusy ? "Building…" : buildLabel}
              </Button>
            ) : null}
            <Button
              size="md"
              variant="primary"
              onClick={() => void submit()}
              disabled={!draft.trim() || !canType}
              className="flex-1 sm:flex-initial sm:min-w-[5rem]"
            >
              Send
            </Button>
          </div>
        </div>
      </motion.div>

      {isHero ? (
        <motion.div
          className="mt-3 flex flex-wrap gap-2"
          initial="hidden"
          animate="visible"
          variants={staggerChildren(0.08, 0.06)}
        >
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s}
              variants={slideUp}
              type="button"
              disabled={!canType}
              onClick={() => void onSend(s)}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              whileHover={reduce ? undefined : { y: -1 }}
              transition={{ type: "spring", stiffness: 520, damping: 30 }}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-[11px] text-parchment/70 transition-colors hover:border-wander/30 hover:bg-wander-muted hover:text-parchment/90 disabled:opacity-40"
            >
              {s}
            </motion.button>
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}
