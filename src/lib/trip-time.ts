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
/** First clock time for the day timeline from the first stop’s intended daypart. */
export function suggestedDayStartMinutes(stops: TripStop[]): { hour: number; minute: number } {
  if (!stops.length) return { hour: 9, minute: 0 };
  const b = stops[0]?.best_time ?? "morning";
  switch (b) {
    case "early_morning":
      return { hour: 7, minute: 30 };
    case "morning":
      return { hour: 9, minute: 0 };
    case "midday":
      return { hour: 11, minute: 0 };
    case "afternoon":
      return { hour: 13, minute: 30 };
    case "evening":
      return { hour: 16, minute: 30 };
    case "night":
      return { hour: 18, minute: 0 };
    default:
      return { hour: 9, minute: 0 };
  }
}

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
