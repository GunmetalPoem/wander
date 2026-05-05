import type { TripPlan, TripStop } from "@/lib/trip-schema";

export function replaceDayStops(plan: TripPlan, dayNum: number, stops: TripStop[]): TripPlan {
  return {
    trip: {
      ...plan.trip,
      days: plan.trip.days.map((d) => (d.day === dayNum ? { ...d, stops } : d)),
    },
  };
}

export function removeStopFromDay(plan: TripPlan, dayNum: number, stopId: string): TripPlan {
  const day = plan.trip.days.find((d) => d.day === dayNum);
  const nextStops = (day?.stops ?? []).filter((s) => s.id !== stopId);
  return replaceDayStops(plan, dayNum, nextStops);
}
