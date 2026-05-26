import { appendMustExclude, type TripChatPatch } from "@/lib/trip-chat-merge";
import { defaultTripForm, type TripFormInput, paceOptions, vibeOptions } from "@/lib/trip-schema";

export type ParticipantPrefsEntry = {
  values: TripChatPatch;
  touched: string[];
  /** Used to break ties on "latest wins" rules; ms epoch. */
  updatedAt: number;
};

export type ConflictReport = {
  field: string;
  values: { participantId: string; value: unknown }[];
  chosen: unknown;
};

export type UnifiedDraftResult = {
  draft: TripFormInput;
  conflicts: ConflictReport[];
};

type Touched<T> = { participantId: string; value: T; updatedAt: number };

function collectTouched<T>(
  prefs: Record<string, ParticipantPrefsEntry>,
  key: keyof TripChatPatch,
): Touched<T>[] {
  const out: Touched<T>[] = [];
  for (const [pid, entry] of Object.entries(prefs)) {
    if (!entry.touched.includes(String(key))) continue;
    const v = (entry.values as Record<string, unknown>)[String(key)];
    if (v === undefined) continue;
    out.push({ participantId: pid, value: v as T, updatedAt: entry.updatedAt });
  }
  return out;
}

function isPace(s: unknown): s is TripFormInput["pace"] {
  return typeof s === "string" && (paceOptions as readonly string[]).includes(s);
}

function isVibe(s: unknown): s is (typeof vibeOptions)[number] {
  return typeof s === "string" && (vibeOptions as readonly string[]).includes(s);
}

export function computeUnifiedDraft(
  prefs: Record<string, ParticipantPrefsEntry>,
  /** Carries forward cityCenter/cityLocationReady set during prior city-candidate confirmation. */
  prior?: TripFormInput,
): UnifiedDraftResult {
  const base: TripFormInput = prior ? { ...prior } : { ...defaultTripForm };
  const conflicts: ConflictReport[] = [];

  // city — latest wins, conflict if labels differ
  const cities = collectTouched<string>(prefs, "city").filter((t) => typeof t.value === "string" && t.value.trim());
  if (cities.length) {
    const latest = cities.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
    const distinct = new Set(cities.map((c) => c.value.trim().toLowerCase()));
    if (distinct.size > 1) {
      conflicts.push({
        field: "city",
        values: cities.map((c) => ({ participantId: c.participantId, value: c.value })),
        chosen: latest.value,
      });
    }
    if ((latest.value || "").trim().toLowerCase() !== (base.city || "").trim().toLowerCase()) {
      base.city = latest.value;
      base.cityCenter = null;
      base.cityLocationReady = false;
    }
  }

  // days — max
  const days = collectTouched<number>(prefs, "days").filter((t) => Number.isFinite(t.value));
  if (days.length) {
    const max = Math.max(...days.map((d) => Math.max(1, Math.min(14, Math.round(d.value)))));
    base.days = max;
    const distinct = new Set(days.map((d) => Math.round(d.value)));
    if (distinct.size > 1) {
      conflicts.push({
        field: "days",
        values: days.map((d) => ({ participantId: d.participantId, value: d.value })),
        chosen: max,
      });
    }
  }

  // groupSize — max
  const groupSize = collectTouched<number>(prefs, "groupSize").filter((t) => Number.isFinite(t.value));
  if (groupSize.length) {
    const max = Math.max(...groupSize.map((g) => Math.max(1, Math.min(50, Math.round(g.value)))));
    base.groupSize = max;
    const distinct = new Set(groupSize.map((g) => Math.round(g.value)));
    if (distinct.size > 1) {
      conflicts.push({
        field: "groupSize",
        values: groupSize.map((g) => ({ participantId: g.participantId, value: g.value })),
        chosen: max,
      });
    }
  }

  // budgetAmount — min (most constraining)
  const budgets = collectTouched<number>(prefs, "budgetAmount").filter((t) => Number.isFinite(t.value));
  if (budgets.length) {
    const min = Math.min(...budgets.map((b) => Math.max(0, Math.min(100000, b.value))));
    base.budgetAmount = min;
    const distinct = new Set(budgets.map((b) => b.value));
    if (distinct.size > 1) {
      conflicts.push({
        field: "budgetAmount",
        values: budgets.map((b) => ({ participantId: b.participantId, value: b.value })),
        chosen: min,
      });
    }
  }

  // pace — majority; tie → latest
  const paces = collectTouched<string>(prefs, "pace").filter((t) => isPace(t.value));
  if (paces.length) {
    const counts = new Map<string, number>();
    for (const p of paces) counts.set(p.value, (counts.get(p.value) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const winner = top[0]![1] === (top[1]?.[1] ?? -1)
      ? paces.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]!.value
      : top[0]![0];
    if (isPace(winner)) base.pace = winner;
    if (counts.size > 1) {
      conflicts.push({
        field: "pace",
        values: paces.map((p) => ({ participantId: p.participantId, value: p.value })),
        chosen: winner,
      });
    }
  }

  // vibes — union
  const vibesEntries = collectTouched<string[]>(prefs, "vibes");
  if (vibesEntries.length) {
    const set = new Set<(typeof vibeOptions)[number]>();
    for (const e of vibesEntries) {
      if (!Array.isArray(e.value)) continue;
      for (const v of e.value) if (isVibe(v)) set.add(v);
    }
    if (set.size > 0) base.vibes = Array.from(set);
  }

  // mustInclude — union of semicolon-joined entries (additive)
  const includes = collectTouched<string>(prefs, "mustInclude").filter((t) => typeof t.value === "string");
  if (includes.length) {
    let acc = "";
    for (const i of includes) acc = appendMustExclude(acc, i.value);
    base.mustInclude = acc;
  }

  // mustExclude — union of semicolon-joined entries (additive)
  const excludes = collectTouched<string>(prefs, "mustExclude").filter((t) => typeof t.value === "string");
  if (excludes.length) {
    let acc = "";
    for (const e of excludes) acc = appendMustExclude(acc, e.value);
    base.mustExclude = acc;
  }

  // transport — driving wins if mixed
  const transports = collectTouched<string>(prefs, "transport").filter(
    (t) => t.value === "walking" || t.value === "driving",
  );
  if (transports.length) {
    const anyDriving = transports.some((t) => t.value === "driving");
    base.transport = anyDriving ? "driving" : "walking";
    const distinct = new Set(transports.map((t) => t.value));
    if (distinct.size > 1) {
      conflicts.push({
        field: "transport",
        values: transports.map((t) => ({ participantId: t.participantId, value: t.value })),
        chosen: base.transport,
      });
    }
  }

  // accessibility — OR booleans, no conflict
  const accs = Object.entries(prefs).flatMap(([pid, e]) =>
    e.touched.includes("accessibility") && e.values.accessibility
      ? [{ participantId: pid, value: e.values.accessibility }]
      : [],
  );
  if (accs.length) {
    const wheelchair = accs.some((a) => Boolean(a.value.wheelchair));
    const lowWalking = accs.some((a) => Boolean(a.value.lowWalking));
    const restStops = accs.some((a) => Boolean(a.value.restStops));
    base.accessibility = { wheelchair, lowWalking, restStops };
  }

  // tripDate — latest wins
  const dates = collectTouched<string>(prefs, "tripDate").filter((t) => typeof t.value === "string" && t.value.trim());
  if (dates.length) {
    const latest = dates.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
    base.tripDate = latest.value.slice(0, 32);
    const distinct = new Set(dates.map((d) => d.value));
    if (distinct.size > 1) {
      conflicts.push({
        field: "tripDate",
        values: dates.map((d) => ({ participantId: d.participantId, value: d.value })),
        chosen: latest.value,
      });
    }
  }

  return { draft: base, conflicts };
}
