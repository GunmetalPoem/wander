"use client";

import { useState } from "react";

type Participant = {
  id: string;
  displayName: string;
  colorHex: string;
  lastSeenAt: number;
};

type Props = {
  roomId: string;
  participants: Participant[];
  meId: string | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function RoomTopBar({ roomId, participants, meId }: Props) {
  const [copied, setCopied] = useState(false);
  const now = Date.now();

  async function copyLink() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/trip/room/${roomId}` : "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-transparent">
          <span className="font-serif text-base text-parchment">W</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-parchment">Trip room</p>
          <p className="text-[10px] uppercase tracking-widest text-parchment/45">{roomId.slice(0, 8)}…</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void copyLink()}
        className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-parchment/80 hover:border-wander/40 hover:text-parchment"
        title="Copy join link"
      >
        {copied ? "Link copied!" : "Copy join link"}
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {participants.map((p) => {
          const stale = now - p.lastSeenAt > 5 * 60 * 1000;
          const isMe = p.id === meId;
          return (
            <div
              key={p.id}
              title={`${p.displayName}${isMe ? " (you)" : ""}${stale ? " · away" : ""}`}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] ${
                stale ? "opacity-50" : ""
              } ${isMe ? "border-wander/40 bg-wander-muted/40" : "border-white/10 bg-white/[0.04]"}`}
            >
              <span
                aria-hidden
                className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-black/80"
                style={{ background: p.colorHex }}
              >
                {initials(p.displayName)}
              </span>
              <span className="text-parchment/90">
                {p.displayName}
                {isMe ? " (you)" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </header>
  );
}
