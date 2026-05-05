import { z } from "zod";

export const paceOptions = ["packed", "balanced", "relaxed"] as const;
export const budgetOptions = ["budget", "mid", "splurge"] as const;
export const vibeOptions = [
  "foodie",
  "history",
  "nightlife",
  "outdoors",
  "art",
  "hidden_gems",
  "family",
  "photography",
] as const;

const BEST: readonly string[] = [
  "early_morning",
  "morning",
  "midday",
  "afternoon",
  "evening",
  "night",
];

function looseNum(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "."));
  if (!Number.isFinite(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function normBestTime(v: unknown): string {
  if (v == null) return "morning";
  const s = String(v).toLowerCase().replace(/[- ]/g, "_");
  if ((BEST as string[]).includes(s)) return s;
  if (s.includes("early") || s === "am" || s === "dawn" || s.includes("sunrise")) return "early_morning";
  if (s.includes("noon") || s === "lunch" || s.includes("midday")) return "midday";
  if (s.includes("after")) return "afternoon";
  if (s.includes("even") || s.includes("sunset") || s.includes("golden")) return "evening";
  if (s.includes("night") || s.includes("late") || s === "pm") return "night";
  if (s.includes("morn") || s.includes("start")) return "morning";
  return "morning";
}

/**
 * Unwraps common model shapes, aliases lat/lng, coerces day numbers.
 * Mutates a plain object; returns payload shaped like `{ trip: { ... } }` when possible.
 */
export function normalizeTripJsonPayload(raw: unknown, fallbackCity: string): unknown {
  if (raw == null) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  const j = { ...(raw as Record<string, unknown>) };

  // { trip: { ... } }
  if (j.trip != null && typeof j.trip === "object" && !Array.isArray(j.trip)) {
    j.trip = walkTripObject(j.trip as Record<string, unknown>, fallbackCity);
    return j;
  }

  // { days: [...] } with optional city, or { city, days, ... } at root
  if (Array.isArray(j.days) && j.days.length > 0) {
    return {
      trip: walkTripObject(
        { city: (j.city ?? j.destination ?? j.place ?? fallbackCity) as string, days: j.days, city_center: j.city_center },
        fallbackCity,
      ),
    };
  }

  // { itinerary: [...] }  (flat days)
  const itin = (j as { itinerary?: unknown }).itinerary;
  if (Array.isArray(itin) && itin.length > 0) {
    const asDays = (itin as { day?: number; date?: string; activities?: unknown[]; stops?: unknown[] }[]).map(
      (d, i) => ({
        day: typeof d.day === "number" ? d.day : i + 1,
        theme: (d as { title?: string; name?: string; theme?: string }).theme ?? (d as { name?: string }).name ?? `Day ${i + 1}`,
        stops: (Array.isArray(d.stops) && d.stops.length > 0 ? d.stops : d.activities) ?? [],
      }),
    );
    return {
      trip: walkTripObject({ city: j.city ?? j.destination ?? fallbackCity, days: asDays, city_center: j.city_center }, fallbackCity),
    };
  }

  return raw;
}

function firstLatLngInTree(x: unknown): { lat: number; lng: number } | null {
  if (x == null) return null;
  if (Array.isArray(x)) {
    for (const e of x) {
      const r = firstLatLngInTree(e);
      if (r) return r;
    }
    return null;
  }
  if (typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const latK = o.lat != null ? o.lat : o.latitude;
  const lngK = o.lng != null ? o.lng : o.longitude;
  if (latK != null && lngK != null) {
    const la = typeof latK === "number" ? latK : parseFloat(String(latK).replace(/,/g, "."));
    const ln = typeof lngK === "number" ? lngK : parseFloat(String(lngK).replace(/,/g, "."));
    if (Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180) {
      return { lat: la, lng: ln };
    }
  }
  for (const v of Object.values(o)) {
    if (v === o.lat || v === o.lng) continue;
    const r = firstLatLngInTree(v);
    if (r) return r;
  }
  return null;
}

function walkTripObject(t: Record<string, unknown>, fallbackCity: string): Record<string, unknown> {
  const city = typeof t.city === "string" && t.city.trim() ? t.city : fallbackCity;
  let days = t.days;
  if (!Array.isArray(days) || days.length === 0) {
    return { ...t, city, days: [] };
  }
  const cc = t.city_center;
  let center: { lat: number; lng: number } | null = null;
  if (cc && typeof cc === "object" && !Array.isArray(cc) && (cc as { lat?: unknown; lng?: unknown })) {
    const cco = cc as { lat: unknown; lng: unknown };
    const la = looseNum(cco.lat, NaN, -90, 90);
    const ln = looseNum(cco.lng, NaN, -180, 180);
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      center = { lat: la, lng: ln };
    }
  }
  if (!center) {
    const inferred = firstLatLngInTree(days) ?? firstLatLngInTree(t);
    if (inferred) {
      center = inferred;
    }
  }
  if (center && (center.lat === 0 && center.lng === 0)) {
    center = null;
  }

  days = days.map((d: unknown) => {
    if (d == null || typeof d !== "object" || Array.isArray(d)) return d;
    const day = d as Record<string, unknown>;
    const n = day.day;
    const dayNum =
      typeof n === "number" && Number.isFinite(n) ? n : Math.max(1, Math.round(parseInt(String(n ?? 1), 10) || 1));
    const theme =
      (typeof day.theme === "string" && day.theme.trim() ? day.theme : null) ??
      (typeof day.label === "string" ? day.label : null) ??
      `Day ${dayNum}`;

    let rawStops: unknown[] = Array.isArray(day.stops) ? (day.stops as unknown[]) : [];
    if (rawStops.length === 0 && Array.isArray((day as { activities?: unknown[] }).activities)) {
      rawStops = (day as { activities: unknown[] }).activities;
    }
    if (!Array.isArray(rawStops)) {
      rawStops = [];
    }
    const ccForStop = center;
    const mapped = rawStops
      .map((s) => mapStopObject(s, ccForStop, city))
      .filter((s): s is NonNullable<typeof s> => s != null);
    return { day: dayNum, theme, stops: mapped };
  });

  const withStops = (days as Record<string, unknown>[]).filter(
    (d) => Array.isArray(d.stops) && (d.stops as unknown[]).length > 0,
  );

  return { ...t, city, city_center: center, days: withStops };
}

function isCoordNullish(v: unknown): boolean {
  return v == null || v === "" || (typeof v === "string" && v.toLowerCase() === "null");
}

function mapStopObject(s: unknown, _cityCenter: { lat: number; lng: number } | null, city: string) {
  if (s == null) return null;
  if (typeof s !== "object" || Array.isArray(s)) return null;
  const o = s as Record<string, unknown>;
  const latIn = o.lat != null ? o.lat : o.latitude;
  const lngIn = o.lng != null ? o.lng : o.longitude;

  let lat: number | null;
  let lng: number | null;
  if (isCoordNullish(latIn) && isCoordNullish(lngIn)) {
    lat = null;
    lng = null;
  } else {
    const tryLat = isCoordNullish(latIn) ? NaN : looseNum(latIn, NaN, -90, 90);
    const tryLng = isCoordNullish(lngIn) ? NaN : looseNum(lngIn, NaN, -180, 180);
    if (Number.isFinite(tryLat) && Number.isFinite(tryLng) && !(tryLat === 0 && tryLng === 0)) {
      lat = tryLat;
      lng = tryLng;
    } else {
      lat = null;
      lng = null;
    }
  }
  const id = typeof o.id === "string" && o.id.trim() ? o.id : `stop_${Math.random().toString(36).slice(2, 10)}`;
  const name =
    (typeof o.name === "string" && o.name.trim() ? o.name : null) ??
    (typeof o.title === "string" && (o.title as string).trim() ? (o.title as string) : null) ??
    (typeof o.place === "string" && (o.place as string).trim() ? (o.place as string) : null) ??
    "Unnamed place";
  const address =
    (typeof o.address === "string" && o.address.trim() ? o.address : null) ??
    (typeof o.formatted_address === "string" ? o.formatted_address : null) ??
    `${name}, ${city}`;

  const category = (typeof o.category === "string" && o.category.trim() ? o.category : "place").slice(0, 80);
  const description =
    (typeof o.description === "string" ? o.description : null) ?? (typeof o.notes === "string" ? o.notes : "") ?? "";
  const transition_to_next = (typeof o.transition_to_next === "string" ? o.transition_to_next : "") as string;
  const dur = o.duration_minutes;
  const duration = typeof dur === "number" && Number.isFinite(dur) ? Math.round(dur) : Math.round(parseFloat(String(dur ?? 60)) || 60);
  const duration_minutes = Math.max(5, Math.min(480, duration));
  const travel = o.travel_minutes_to_next;
  const travel_minutes_to_next =
    travel == null ? (typeof o.travel_time_minutes === "number" ? o.travel_time_minutes : null) : (typeof travel === "number" && Number.isFinite(travel) ? travel : null);

  const locationResolved = lat != null && lng != null ? undefined : false;

  return {
    id,
    name: name.slice(0, 200),
    address: address.slice(0, 500),
    lat,
    lng,
    category,
    duration_minutes,
    best_time: normBestTime(o.best_time),
    description: String(description).slice(0, 2000),
    transition_to_next: String(transition_to_next).slice(0, 1000),
    travel_minutes_to_next: travel_minutes_to_next as number | null,
    locationResolved,
  };
}

const StopSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  lat: z.union([z.number().min(-90).max(90), z.null()]),
  lng: z.union([z.number().min(-180).max(180), z.null()]),
  category: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(480).optional().default(60),
  best_time: z
    .enum(["early_morning", "morning", "midday", "afternoon", "evening", "night"])
    .optional()
    .default("morning"),
  description: z.string().optional().default(""),
  transition_to_next: z.string().optional().default(""),
  travel_minutes_to_next: z
    .preprocess(
      (v) => (v == null || v === "" ? v : Number(v)),
      z.union([z.number(), z.null()]).optional(),
    ),
  locationResolved: z.boolean().optional(),
  locationConfidence: z.number().min(0).max(1).optional(),
  resolvedName: z.string().optional(),
  resolvedAddress: z.string().optional(),
  details: z
    .object({
      provider: z.enum(["google", "osm"]).optional(),
      placeId: z.string().optional(),
      types: z.array(z.string()).optional(),
      cuisine: z.string().optional(),
      openingHoursText: z.array(z.string()).optional(),
      website: z.string().url().optional(),
      deepSourceUrl: z.string().url().optional(),
      phone: z.string().optional(),
      priceLevel: z.number().int().min(0).max(4).optional(),
      wheelchairAccessibleEntrance: z.boolean().optional(),
      admission: z
        .object({
          summary: z.string().optional(),
          member: z.string().optional(),
          adult: z.string().optional(),
          student: z.string().optional(),
          child: z.string().optional(),
          teen: z.string().optional(),
          senior: z.string().optional(),
          freeDays: z.string().optional(),
        })
        .optional(),
      fees: z
        .object({
          parking: z.string().optional(),
          permit: z.string().optional(),
          entry: z.string().optional(),
        })
        .optional(),
      menuHighlights: z.array(z.string()).optional(),
      ticketingUrl: z.string().url().optional(),
    })
    .optional(),
});

const DaySchema = z.object({
  day: z.number().int().min(1).max(30),
  theme: z.string(),
  stops: z.array(StopSchema).min(1).max(20),
});

export const TripPlanSchema = z.object({
  trip: z.object({
    city: z.string(),
    city_center: z
      .object({ lat: z.number(), lng: z.number() })
      .optional(),
    days: z.array(DaySchema).min(1).max(14),
  }),
});

export type TripPlan = z.infer<typeof TripPlanSchema>;
export type TripStop = z.infer<typeof StopSchema>;
export type TripDay = z.infer<typeof DaySchema>;

export type TripFormInput = {
  city: string;
  /** Set when the user picks a place (or a single unambiguous match) — sent to the server to pin the right city. */
  cityCenter: { lat: number; lng: number } | null;
  /**
   * When false, several city matches exist and the user must pick from the dropdown.
   * Prevents generating a trip in the wrong state.
   */
  cityLocationReady: boolean;
  days: number;
  groupSize: number;
  /** Per-day budget in user's local currency (treated as USD in prompts/UI for now). */
  budgetAmount: number;
  pace: (typeof paceOptions)[number];
  vibes: (typeof vibeOptions)[number][];
  mustInclude: string;
  /** Semicolon-separated place names to never include (manual deletes + chat patch). Sent to the planner API. */
  mustExclude: string;
  transport: "walking" | "driving";
  /** Optional trip start date (YYYY-MM-DD) used for weather-aware planning. */
  tripDate: string;
  accessibility: {
    wheelchair: boolean;
    lowWalking: boolean;
    restStops: boolean;
  };
};

export const defaultTripForm: TripFormInput = {
  city: "San Francisco",
  cityCenter: null,
  /** Becomes true after the first city-candidates lookup (or on explicit demo load). */
  cityLocationReady: false,
  days: 1,
  groupSize: 2,
  budgetAmount: 180,
  pace: "balanced",
  vibes: ["foodie", "outdoors"],
  mustInclude: "",
  mustExclude: "",
  transport: "walking",
  tripDate: "",
  accessibility: {
    wheelchair: false,
    lowWalking: false,
    restStops: false,
  },
};

/** Hardcoded demo for map / UI tests without AI. */
export const demoTripSanFrancisco: TripPlan = {
  trip: {
    city: "San Francisco",
    city_center: { lat: 37.7749, lng: -122.4194 },
    days: [
      {
        day: 1,
        theme: "The iconic core",
        stops: [
          {
            id: "sf_1",
            name: "Dolores Park",
            address: "Dolores St & 19th St, San Francisco, CA",
            lat: 37.7596,
            lng: -122.4269,
            category: "outdoor",
            duration_minutes: 60,
            best_time: "morning",
            description: "Hilltop views, people-watching, quick coffee nearby on Valencia.",
            transition_to_next: "Short walk into the Mission for murals and lunch options.",
            travel_minutes_to_next: 12,
          },
          {
            id: "sf_2",
            name: "Clarion Alley",
            address: "Clarion Alley, San Francisco, CA",
            lat: 37.7626,
            lng: -122.4221,
            category: "art",
            duration_minutes: 30,
            best_time: "midday",
            description: "Concentrated mural art in a walk-through alley.",
            transition_to_next: "Transit or walk toward downtown; optional detour to Hayes Valley.",
            travel_minutes_to_next: 25,
          },
          {
            id: "sf_3",
            name: "Ferry Building",
            address: "1 Ferry Building, San Francisco, CA",
            lat: 37.7953,
            lng: -122.3934,
            category: "foodie",
            duration_minutes: 45,
            best_time: "afternoon",
            description: "Indoor market, bay views, and local vendors.",
            transition_to_next: "",
            travel_minutes_to_next: null,
          },
        ],
      },
    ],
  },
};
