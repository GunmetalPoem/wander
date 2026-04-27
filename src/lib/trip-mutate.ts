import type { TripPlan, TripStop } from "@/lib/trip-schema";

export function replaceDayStops(plan: TripPlan, dayNum: number, stops: TripStop[]): TripPlan {
  return {
    trip: {
      ...plan.trip,
      days: plan.trip.days.map((d) => (d.day === dayNum ? { ...d, stops } : d)),
    },
  };
}
