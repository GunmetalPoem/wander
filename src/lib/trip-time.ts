import type { TripStop } from "@/lib/trip-schema";

export type ScheduledStop = {
  stop: TripStop;
  arrivalLabel: string;
  departLabel: string;
  travelMinsToNext: number | null;
};

function fmt(h: number, m: number) {
  const p = h >= 12 ? "PM" : "AM";
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hr}:${m.toString().padStart(2, "0")} ${p}`;
}

/**
 * Arrival / depart labels from a simple minute timeline.
 * `legDurationSeconds[i]` = travel from stop i to i+1.
 */
export function scheduleDayStops(
  stops: TripStop[],
  legDurationSeconds: number[],
  startHour = 9,
  startMinute = 0,
): ScheduledStop[] {
  let t = startHour * 60 + startMinute;
  const out: ScheduledStop[] = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    const h = Math.min(23, Math.floor(t / 60));
    const mi = t % 60;
    const arrival = fmt(h, mi);
    const dur = stop.duration_minutes ?? 60;
    const tEnd = t + dur;
    const h2 = Math.min(23, Math.floor(tEnd / 60));
    const m2 = tEnd % 60;
    const depart = fmt(h2, m2);
    const travelMinsToNext =
      i < stops.length - 1
        ? legDurationSeconds[i] != null
          ? Math.max(1, Math.round(legDurationSeconds[i]! / 60))
          : stop.travel_minutes_to_next ?? 10
        : null;
    out.push({ stop, arrivalLabel: arrival, departLabel: depart, travelMinsToNext });
    t = tEnd;
    if (i < stops.length - 1) {
      const sec =
        legDurationSeconds[i] != null
          ? legDurationSeconds[i]!
          : (stop.travel_minutes_to_next ?? 10) * 60;
      t += sec / 60;
    }
  }
  return out;
}
