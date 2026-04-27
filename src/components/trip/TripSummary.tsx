"use client";

import type { TripPlan } from "@/lib/trip-schema";

type Props = {
  plan: TripPlan;
  activeDay: number;
  totalWalkMinutes: number | null;
  totalDistanceKm: number | null;
  stopCount: number;
};

function stopsForDay(plan: TripPlan, day: number) {
  return plan.trip.days.find((d) => d.day === day)?.stops ?? [];
}

export function TripSummary({ plan, activeDay, totalWalkMinutes, totalDistanceKm, stopCount }: Props) {
  const dayTheme = plan.trip.days.find((d) => d.day === activeDay)?.theme ?? "—";
  return (
    <div className="shrink-0 space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-parchment/80">
      <p className="text-[10px] uppercase tracking-widest text-parchment/50">Day {activeDay} theme</p>
      <p className="text-sm text-parchment/90">{dayTheme}</p>
      <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-2">
        <div>
          <p className="text-parchment/50">Stops (today)</p>
          <p className="text-lg font-serif text-ember/95">{stopCount}</p>
        </div>
        <div>
          <p className="text-parchment/50">Route (today)</p>
          <p className="text-parchment/90">
            {totalDistanceKm != null ? `${totalDistanceKm.toFixed(1)} km` : "—"}
            {totalWalkMinutes != null && (
              <span className="ml-1 text-parchment/60">· {Math.round(totalWalkMinutes)} min</span>
            )}
          </p>
        </div>
      </div>
      <p className="text-parchment/40">Estimates from Mapbox routing; add buffer for meals and lines.</p>
    </div>
  );
}
