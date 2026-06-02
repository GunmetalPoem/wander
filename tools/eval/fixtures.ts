// Benchmark fixtures for the route optimizer.
//
// Each fixture is a realistic multi-stop day with REAL coordinates for
// well-known venues, deliberately authored in the kind of "zig-zag across
// town" order that a raw LLM itinerary frequently produces (it lists places
// by fame or by free-association, not by geography). This is the baseline the
// optimizer is meant to fix. Coordinates are approximate but real enough that
// straight-line distances are meaningful.
//
// best_time buckets are set realistically; the optimizer only reorders WITHIN
// a non-decreasing time-of-day ordering, so these fixtures test that it both
// (a) shortens the path and (b) never reorders dinner before breakfast.

import type { TripPlan, TripStop } from "../../src/lib/trip-schema.ts";

type Seed = {
  name: string;
  lat: number;
  lng: number;
  best_time: TripStop["best_time"];
  category?: string;
};

function stop(i: number, s: Seed): TripStop {
  return {
    id: `s${i}`,
    name: s.name,
    address: s.name,
    lat: s.lat,
    lng: s.lng,
    category: s.category ?? "place",
    duration_minutes: 60,
    best_time: s.best_time,
    description: s.name,
    transition_to_next: "",
    travel_minutes_to_next: null,
  };
}

function day(dayNum: number, theme: string, seeds: Seed[]): TripPlan["trip"]["days"][number] {
  return { day: dayNum, theme, stops: seeds.map((s, i) => stop(dayNum * 100 + i, s)) };
}

export type Fixture = {
  name: string;
  plan: TripPlan;
};

export const fixtures: Fixture[] = [
  {
    name: "San Francisco — walking day (classic tourist zig-zag)",
    plan: {
      trip: {
        city: "San Francisco",
        city_center: { lat: 37.7749, lng: -122.4194 },
        days: [
          day(1, "Icons", [
            // morning cluster authored out of order
            { name: "Golden Gate Bridge", lat: 37.8199, lng: -122.4783, best_time: "morning" },
            { name: "Coit Tower", lat: 37.8024, lng: -122.4058, best_time: "morning" },
            { name: "Palace of Fine Arts", lat: 37.8029, lng: -122.4484, best_time: "morning" },
            // midday meal
            { name: "Ferry Building Marketplace", lat: 37.7955, lng: -122.3937, best_time: "midday", category: "foodie" },
            // afternoon cluster authored as a back-and-forth across the city
            { name: "Lombard Street", lat: 37.8021, lng: -122.4187, best_time: "afternoon" },
            { name: "Dolores Park", lat: 37.7596, lng: -122.4269, best_time: "afternoon" },
            { name: "Lombard / Fisherman's Wharf", lat: 37.808, lng: -122.4177, best_time: "afternoon" },
            { name: "Mission Dolores", lat: 37.7644, lng: -122.4255, best_time: "afternoon" },
          ]),
        ],
      },
    },
  },
  {
    name: "New York — Manhattan day (uptown/downtown ping-pong)",
    plan: {
      trip: {
        city: "New York",
        city_center: { lat: 40.7549, lng: -73.984 },
        days: [
          day(1, "Manhattan highlights", [
            { name: "American Museum of Natural History", lat: 40.7813, lng: -73.974, best_time: "morning" },
            { name: "Statue of Liberty Ferry (Battery Park)", lat: 40.7033, lng: -74.017, best_time: "morning" },
            { name: "The Met", lat: 40.7794, lng: -73.9632, best_time: "morning" },
            { name: "Katz's Delicatessen", lat: 40.7223, lng: -73.9874, best_time: "midday", category: "foodie" },
            { name: "Times Square", lat: 40.758, lng: -73.9855, best_time: "afternoon" },
            { name: "One World Observatory", lat: 40.7127, lng: -74.0134, best_time: "afternoon" },
            { name: "Empire State Building", lat: 40.7484, lng: -73.9857, best_time: "afternoon" },
            { name: "Rockefeller Center", lat: 40.7587, lng: -73.9787, best_time: "afternoon" },
          ]),
        ],
      },
    },
  },
  {
    name: "Paris — two days (Left/Right bank crossings)",
    plan: {
      trip: {
        city: "Paris",
        city_center: { lat: 48.8566, lng: 2.3522 },
        days: [
          day(1, "Right bank + islands", [
            { name: "Arc de Triomphe", lat: 48.8738, lng: 2.295, best_time: "morning" },
            { name: "Père Lachaise", lat: 48.8614, lng: 2.3933, best_time: "morning" },
            { name: "Louvre", lat: 48.8606, lng: 2.3376, best_time: "morning" },
            { name: "Le Comptoir (lunch)", lat: 48.8529, lng: 2.3387, best_time: "midday", category: "foodie" },
            { name: "Notre-Dame", lat: 48.853, lng: 2.3499, best_time: "afternoon" },
            { name: "Sacré-Cœur (Montmartre)", lat: 48.8867, lng: 2.3431, best_time: "afternoon" },
            { name: "Centre Pompidou", lat: 48.8607, lng: 2.3522, best_time: "afternoon" },
          ]),
          day(2, "Left bank", [
            { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945, best_time: "morning" },
            { name: "Panthéon", lat: 48.8462, lng: 2.3464, best_time: "morning" },
            { name: "Musée d'Orsay", lat: 48.86, lng: 2.3266, best_time: "morning" },
            { name: "Les Deux Magots", lat: 48.854, lng: 2.3333, best_time: "midday", category: "foodie" },
            { name: "Luxembourg Gardens", lat: 48.8462, lng: 2.3372, best_time: "afternoon" },
            { name: "Catacombs", lat: 48.8338, lng: 2.3324, best_time: "afternoon" },
            { name: "Rodin Museum", lat: 48.8553, lng: 2.3158, best_time: "afternoon" },
          ]),
        ],
      },
    },
  },
  {
    name: "London — central day (Westminster/City zig-zag)",
    plan: {
      trip: {
        city: "London",
        city_center: { lat: 51.5074, lng: -0.1278 },
        days: [
          day(1, "Central London", [
            { name: "Tower of London", lat: 51.5081, lng: -0.0759, best_time: "morning" },
            { name: "Westminster Abbey", lat: 51.4994, lng: -0.1273, best_time: "morning" },
            { name: "St Paul's Cathedral", lat: 51.5138, lng: -0.0984, best_time: "morning" },
            { name: "Borough Market", lat: 51.5055, lng: -0.0909, best_time: "midday", category: "foodie" },
            { name: "British Museum", lat: 51.5194, lng: -0.127, best_time: "afternoon" },
            { name: "London Eye", lat: 51.5033, lng: -0.1196, best_time: "afternoon" },
            { name: "Trafalgar Square", lat: 51.508, lng: -0.1281, best_time: "afternoon" },
            { name: "Buckingham Palace", lat: 51.5014, lng: -0.1419, best_time: "afternoon" },
          ]),
        ],
      },
    },
  },
  {
    name: "Tokyo — central day (sprawling ward hops)",
    plan: {
      trip: {
        city: "Tokyo",
        city_center: { lat: 35.6762, lng: 139.6503 },
        days: [
          day(1, "Tokyo highlights", [
            { name: "Senso-ji (Asakusa)", lat: 35.7148, lng: 139.7967, best_time: "morning" },
            { name: "Meiji Shrine (Harajuku)", lat: 35.6764, lng: 139.6993, best_time: "morning" },
            { name: "Tokyo Skytree", lat: 35.71, lng: 139.8107, best_time: "morning" },
            { name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, best_time: "midday", category: "foodie" },
            { name: "Shibuya Crossing", lat: 35.6595, lng: 139.7004, best_time: "afternoon" },
            { name: "teamLab Planets (Toyosu)", lat: 35.6492, lng: 139.7896, best_time: "afternoon" },
            { name: "Shinjuku Gyoen", lat: 35.6852, lng: 139.71, best_time: "afternoon" },
          ]),
        ],
      },
    },
  },
];
