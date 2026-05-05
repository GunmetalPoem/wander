"use client";

import { defaultTripForm, paceOptions, vibeOptions, type TripFormInput } from "@/lib/trip-schema";

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
            max={50}
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
          <label className="text-xs text-parchment/50">Budget (per day)</label>
          <input
            type="number"
            min={0}
            max={100000}
            step={10}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-parchment"
            value={Number.isFinite(value.budgetAmount) ? value.budgetAmount : 0}
            onChange={(e) =>
              onChange({ ...value, budgetAmount: Math.max(0, Math.min(100000, Number(e.target.value) || 0)) })
            }
          />
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-parchment/50">Trip date (optional)</label>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-parchment"
            value={value.tripDate}
            onChange={(e) => onChange({ ...value, tripDate: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-parchment/50">Accessibility</label>
          <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
            {(
              [
                ["wheelchair", "Wheelchair-friendly"],
                ["lowWalking", "Low walking distance"],
                ["restStops", "Rest stops (bathrooms/benches)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 text-xs text-parchment/80">
                <input
                  type="checkbox"
                  checked={value.accessibility[k]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      accessibility: { ...value.accessibility, [k]: e.target.checked },
                    })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
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
                  on ? "bg-wander/85 text-void" : "bg-white/5 text-parchment/80 hover:bg-white/10"
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
        <label className="text-xs text-parchment/50">Never include (optional)</label>
        <textarea
          rows={2}
          className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-parchment placeholder:text-parchment/30"
          placeholder="Places to skip on the next rebuild — also filled when you delete a stop from the timeline."
          value={value.mustExclude}
          onChange={(e) => onChange({ ...value, mustExclude: e.target.value.slice(0, 2000) })}
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
                value.transport === k ? "bg-wander/85 text-void" : "bg-white/5 text-parchment/80"
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
          className="rounded-lg bg-wander px-4 py-2.5 text-sm font-medium text-void hover:bg-wander/90 disabled:opacity-50"
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
