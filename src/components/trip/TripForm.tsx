"use client";

import { budgetOptions, defaultTripForm, paceOptions, vibeOptions, type TripFormInput } from "@/lib/trip-schema";
import { CityConfirmField } from "./CityConfirmField";

type Props = {
  value: TripFormInput;
  onChange: (v: TripFormInput) => void;
  onSubmit: () => void;
  onLoadDemo: () => void;
  busy: boolean;
};

export function TripForm({ value, onChange, onSubmit, onLoadDemo, busy }: Props) {
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-parchment/90">
      <CityConfirmField value={value} onChange={onChange} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-parchment/50">Days</label>
          <input
            type="number"
            min={1}
            max={14}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-parchment"
            value={value.days}
            onChange={(e) => onChange({ ...value, days: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })}
          />
        </div>
        <div>
          <label className="text-xs text-parchment/50">Group size</label>
          <input
            type="number"
            min={1}
            max={20}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-parchment"
            value={value.groupSize}
            onChange={(e) =>
              onChange({ ...value, groupSize: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
            }
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-parchment/50">Budget</label>
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-parchment"
            value={value.budget}
            onChange={(e) => onChange({ ...value, budget: e.target.value as TripFormInput["budget"] })}
          >
            {budgetOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-parchment/50">Pace</label>
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-parchment"
            value={value.pace}
            onChange={(e) => onChange({ ...value, pace: e.target.value as TripFormInput["pace"] })}
          >
            {paceOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-parchment/50">Vibes (toggle)</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {vibeOptions.map((v) => {
            const on = value.vibes.includes(v);
            return (
              <button
                type="button"
                key={v}
                onClick={() =>
                  onChange({
                    ...value,
                    vibes: on ? value.vibes.filter((x) => x !== v) : [...value.vibes, v],
                  })
                }
                className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                  on ? "bg-ember/80 text-white" : "bg-white/5 text-parchment/80 hover:bg-white/10"
                }`}
              >
                {v.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="text-xs text-parchment/50">Must include (optional)</label>
        <input
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-parchment placeholder:text-parchment/30"
          placeholder="e.g. Tartine, Golden Gate Park…"
          value={value.mustInclude}
          onChange={(e) => onChange({ ...value, mustInclude: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-parchment/50">Between stops</label>
        <div className="mt-1 flex gap-2">
          {(
            [
              ["walking", "Walk"],
              ["driving", "Drive"],
            ] as const
          ).map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => onChange({ ...value, transport: k })}
              className={`flex-1 rounded-lg py-2 text-xs ${
                value.transport === k ? "bg-ember/80 text-white" : "bg-white/5 text-parchment/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !value.cityLocationReady}
          className="rounded-lg bg-ember px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Planning…" : "Generate trip"}
        </button>
        <button
          type="button"
          onClick={onLoadDemo}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-parchment/90 hover:bg-white/10"
        >
          Load SF demo
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...defaultTripForm })}
          className="rounded-lg px-2 py-2.5 text-xs text-parchment/50 hover:text-parchment"
        >
          Reset form
        </button>
      </div>
    </div>
  );
}
