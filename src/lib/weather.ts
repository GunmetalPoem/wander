type DailyForecast = {
  date: string; // YYYY-MM-DD
  tempMaxC: number | null;
  tempMinC: number | null;
  precipProbMax: number | null;
  weatherCode: number | null;
};

export type TripWeather = {
  provider: "open-meteo";
  latitude: number;
  longitude: number;
  timezone: string | null;
  daily: DailyForecast | null;
};

function isIsoDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function nOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Fetches daily forecast for the given date (if available).
 * Uses Open-Meteo (no API key).
 */
export async function fetchTripWeather(
  lat: number | null | undefined,
  lng: number | null | undefined,
  date: string | null | undefined,
): Promise<TripWeather | null> {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!date || !isIsoDate(date)) return null;

  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  u.searchParams.set("timezone", "auto");
  u.searchParams.set("start_date", date);
  u.searchParams.set("end_date", date);

  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return null;

  const j = (await res.json()) as {
    timezone?: string;
    daily?: {
      time?: string[];
      weathercode?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  };

  const i = 0;
  const day = j.daily?.time?.[i];
  if (!day || !isIsoDate(day)) {
    return {
      provider: "open-meteo",
      latitude: lat,
      longitude: lng,
      timezone: typeof j.timezone === "string" ? j.timezone : null,
      daily: null,
    };
  }

  return {
    provider: "open-meteo",
    latitude: lat,
    longitude: lng,
    timezone: typeof j.timezone === "string" ? j.timezone : null,
    daily: {
      date: day,
      tempMaxC: nOrNull(j.daily?.temperature_2m_max?.[i]),
      tempMinC: nOrNull(j.daily?.temperature_2m_min?.[i]),
      precipProbMax: nOrNull(j.daily?.precipitation_probability_max?.[i]),
      weatherCode: nOrNull(j.daily?.weathercode?.[i]),
    },
  };
}

