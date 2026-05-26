"use client";

import { useState } from "react";

type Props = {
  roomId: string;
  onJoined: (participant: { id: string; displayName: string; colorHex: string }) => void;
};

export function RoomJoinModal({ roomId, onJoined }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a display name to join.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trip/room/${roomId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Could not join. Try again.");
        setBusy(false);
        return;
      }
      const j = (await res.json()) as { participantId: string; displayName: string; colorHex: string };
      onJoined({ id: j.participantId, displayName: j.displayName, colorHex: j.colorHex });
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-coal p-5 shadow-xl shadow-black/60">
        <h2 className="font-serif text-xl text-parchment">Join trip room</h2>
        <p className="mt-1 text-sm text-parchment/60">
          Pick a name your friends will recognise. No login needed.
        </p>
        <input
          type="text"
          autoFocus
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Your name"
          className="mt-4 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-parchment outline-none focus:border-wander/40"
        />
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className="mt-4 w-full rounded-xl bg-wander px-4 py-2 text-sm font-semibold text-ink hover:bg-wander/90 disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join"}
        </button>
      </div>
    </div>
  );
}
