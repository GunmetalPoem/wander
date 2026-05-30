"use client";

import { useMemo, useState } from "react";
import { WanderIcon } from "@/components/WanderIcon";
import AvatarStack, { type AvatarItem } from "@/components/ui/AvatarStack";
import Button from "@/components/ui/Button";
import { motion } from "@/components/ui/Motion";
import { useToast } from "@/components/ui/Toast";

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
  const toast = useToast();
  const now = Date.now();

  const items = useMemo<AvatarItem[]>(
    () =>
      participants.map((p) => ({
        id: p.id,
        initials: initials(p.displayName),
        color: p.colorHex,
        label: p.displayName,
        stale: now - p.lastSeenAt > 5 * 60 * 1000,
        isSelf: p.id === meId,
      })),
    [participants, meId, now],
  );

  async function copyLink() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/trip/room/${roomId}` : "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Join link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-coal/60 px-4 py-2.5 backdrop-blur-xl">
      <motion.div
        className="flex items-center gap-2.5"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32 }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent">
          <WanderIcon size={22} strokeWidth={2.25} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-parchment">Trip room</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-parchment/40">
            {roomId.slice(0, 8)}…
          </p>
        </div>
      </motion.div>

      <div className="flex items-center gap-2.5">
        <AvatarStack items={items} max={4} size="sm" />
        <Button
          variant="icon"
          size="sm"
          onClick={() => void copyLink()}
          aria-label={copied ? "Link copied" : "Copy join link"}
          title={copied ? "Link copied!" : "Copy join link"}
        >
          {copied ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10 13a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 1 0-7.07-7.07l-1.41 1.41" />
              <path d="M14 11a5 5 0 0 0-7.07 0L3.4 14.54a5 5 0 1 0 7.07 7.07l1.41-1.41" />
            </svg>
          )}
        </Button>
      </div>
    </header>
  );
}
