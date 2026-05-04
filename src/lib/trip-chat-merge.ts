import { defaultTripForm, paceOptions, type TripFormInput, vibeOptions } from "@/lib/trip-schema";

export type TripChatPatch = {
  city?: string;
  days?: number;
  groupSize?: number;
  budgetAmount?: number;
  pace?: string;
  vibes?: string[];
  mustInclude?: string;
  transport?: string;
  tripDate?: string;
  accessibility?: Partial<TripFormInput["accessibility"]>;
};

function isPace(s: string): s is TripFormInput["pace"] {
  return (paceOptions as readonly string[]).includes(s);
}

function normalizeVibes(v: unknown): TripFormInput["vibes"] {
  if (!Array.isArray(v)) return defaultTripForm.vibes;
  const allowed = new Set(vibeOptions as readonly string[]);
  const out = v.filter((x): x is (typeof vibeOptions)[number] => typeof x === "string" && allowed.has(x as (typeof vibeOptions)[number]));
  return out.length ? out : defaultTripForm.vibes;
}

/** Loose compare so repeated model patches like "San Francisco" vs "San Francisco, CA, USA" don't wipe geocode. */
function sameCityLabel(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
  const y = b.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
  if (x === y) return true;
  if (x.length < 4 || y.length < 4) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * When the user sends a short correction, apply it even if the model skipped patch fields.
 * Runs on the latest user message only (caller passes that string).
 */
export function applyLastUserMessageTweaks(text: string, form: TripFormInput): TripFormInput {
  const raw = text.trim();
  if (!raw) return form;
  const next: TripFormInput = { ...form };
  const t = raw.toLowerCase();

  if (
    /\bdriv(e|ing)?\b|\bby car\b|\bin (a |the )?car\b|\brent(ing)? a car\b|\broad trip\b/i.test(raw) ||
    (raw.length <= 32 && /^(driving|drive|car)$/i.test(raw.trim()))
  ) {
    next.transport = "driving";
  }
  if (
    (/\bwalking\b|\bon foot\b|\bwalk only\b/i.test(raw) ||
      /\bpublic transit\b|\bby train\b|\bsubway\b|\bmetro\b/i.test(raw)) &&
    !/\bdriv/i.test(raw) &&
    raw.length <= 100
  ) {
    next.transport = "walking";
  }

  let money =
    raw.match(/\$\s*(\d{1,5})\b/i) ??
    raw.match(/\b(\d{1,5})\s*(?:\$|usd|bucks)\b/i) ??
    raw.match(/\b(\d{1,5})\s*(?:\/\s*day|per\s*day|for\s*(?:the\s*)?day|a\s*day)\b/i);
  if (!money) {
    money = raw.match(/\b(?:just|only)\s*\$?\s*(\d{1,5})\b/i);
  }
  if (money) {
    const n = parseInt((money[1] ?? "").replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100000) {
      next.budgetAmount = n;
    }
  }

  if (/\bweekend\b/i.test(t) && raw.length < 80) {
    next.days = Math.max(next.days, 2);
  }

  return next;
}

export function mergeTripChatPatch(form: TripFormInput, patch: TripChatPatch | undefined): TripFormInput {
  if (!patch) return form;
  const next: TripFormInput = { ...form };
  if (typeof patch.city === "string" && patch.city.trim()) {
    const p = patch.city.trim();
    if (sameCityLabel(p, form.city)) {
      // Keep resolved center + ready state; model may shorten the label.
      next.city = form.city;
    } else {
      next.city = p;
      next.cityCenter = null;
      next.cityLocationReady = false;
    }
  }
  if (typeof patch.days === "number" && Number.isFinite(patch.days)) {
    next.days = Math.max(1, Math.min(14, Math.round(patch.days)));
  }
  if (typeof patch.groupSize === "number" && Number.isFinite(patch.groupSize)) {
    next.groupSize = Math.max(1, Math.min(50, Math.round(patch.groupSize)));
  }
  if (typeof patch.budgetAmount === "number" && Number.isFinite(patch.budgetAmount)) {
    next.budgetAmount = Math.max(0, Math.min(100000, patch.budgetAmount));
  }
  if (typeof patch.pace === "string" && isPace(patch.pace)) {
    next.pace = patch.pace;
  }
  if (patch.vibes != null) {
    next.vibes = normalizeVibes(patch.vibes);
  }
  if (typeof patch.mustInclude === "string") {
    next.mustInclude = patch.mustInclude.slice(0, 2000);
  }
  if (patch.transport === "walking" || patch.transport === "driving") {
    next.transport = patch.transport;
  }
  if (typeof patch.tripDate === "string") {
    next.tripDate = patch.tripDate.slice(0, 32);
  }
  if (patch.accessibility && typeof patch.accessibility === "object") {
    next.accessibility = {
      wheelchair: Boolean(patch.accessibility.wheelchair ?? next.accessibility.wheelchair),
      lowWalking: Boolean(patch.accessibility.lowWalking ?? next.accessibility.lowWalking),
      restStops: Boolean(patch.accessibility.restStops ?? next.accessibility.restStops),
    };
  }
  return next;
}
