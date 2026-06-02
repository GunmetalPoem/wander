// Route-optimizer benchmark.
//
// Measures what `optimizeTripPlanForCloseness` actually buys you: how much
// shorter each day's walking/driving path gets after the deterministic
// time-bucket + nearest-neighbor + 2-opt pass, versus the raw "as the model
// listed them" order. Also checks two invariants the optimizer must never
// violate:
//   1. It never makes a day LONGER (the optimizer is a non-worsening transform).
//   2. It never reorders a later time-of-day before an earlier one
//      (no dinner-before-breakfast).
//
// Distance here is computed by an INDEPENDENT haversine (not the optimizer's
// own internal one) so the measurement doesn't just echo the implementation.
//
// Run with Node 22.6+ (TypeScript type-stripping): `npm run eval`
// Writes a human-readable report to docs/eval-results.md.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { optimizeTripPlanForCloseness } from "../../src/lib/trip-optimize.ts";
import { fixtures } from "./fixtures.ts";
import type { TripStop } from "../../src/lib/trip-schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BEST_ORDER: Record<string, number> = {
  early_morning: 0,
  morning: 1,
  midday: 2,
  afternoon: 3,
  evening: 4,
  night: 5,
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function pathKm(stops: TripStop[]): number {
  const pts = stops.filter(
    (s): s is TripStop & { lat: number; lng: number } =>
      typeof s.lat === "number" && typeof s.lng === "number",
  );
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += haversineKm(pts[i], pts[i + 1]);
  }
  return total;
}

/** True if time-of-day buckets are non-decreasing along the stop list. */
function timeOrderMonotonic(stops: TripStop[]): boolean {
  let prev = -1;
  for (const s of stops) {
    const b = BEST_ORDER[s.best_time ?? "morning"] ?? 1;
    if (b < prev) return false;
    prev = b;
  }
  return true;
}

type DayResult = {
  fixture: string;
  day: number;
  theme: string;
  stops: number;
  beforeKm: number;
  afterKm: number;
  reductionPct: number;
  monotonicBefore: boolean;
  monotonicAfter: boolean;
  regressed: boolean;
};

const results: DayResult[] = [];

for (const fx of fixtures) {
  const optimized = optimizeTripPlanForCloseness(fx.plan);
  for (let d = 0; d < fx.plan.trip.days.length; d++) {
    const before = fx.plan.trip.days[d];
    const after = optimized.trip.days[d];
    const beforeKm = pathKm(before.stops);
    const afterKm = pathKm(after.stops);
    const reductionPct = beforeKm > 0 ? ((beforeKm - afterKm) / beforeKm) * 100 : 0;
    results.push({
      fixture: fx.name,
      day: before.day,
      theme: before.theme,
      stops: before.stops.length,
      beforeKm,
      afterKm,
      reductionPct,
      monotonicBefore: timeOrderMonotonic(before.stops),
      monotonicAfter: timeOrderMonotonic(after.stops),
      regressed: afterKm > beforeKm + 1e-6,
    });
  }
}

// ---- aggregate ----
const totalBefore = results.reduce((a, r) => a + r.beforeKm, 0);
const totalAfter = results.reduce((a, r) => a + r.afterKm, 0);
const overallReduction = ((totalBefore - totalAfter) / totalBefore) * 100;
const meanReduction = results.reduce((a, r) => a + r.reductionPct, 0) / results.length;
const anyRegression = results.some((r) => r.regressed);
const anyMonotonicBreak = results.some((r) => !r.monotonicAfter);
const improvedDays = results.filter((r) => r.reductionPct > 0.01).length;

// ---- console report ----
const fmt = (n: number) => n.toFixed(1);
const pct = (n: number) => `${n >= 0 ? "" : ""}${n.toFixed(1)}%`;

console.log("\n=== Wander route-optimizer benchmark ===\n");
const col = (s: string, w: number) => s.padEnd(w);
console.log(
  col("Fixture / day", 46) + col("stops", 7) + col("before", 9) + col("after", 9) + col("Δ", 9),
);
console.log("-".repeat(80));
for (const r of results) {
  const label = `${r.fixture.split(" — ")[0]} d${r.day}`;
  console.log(
    col(label, 46) +
      col(String(r.stops), 7) +
      col(`${fmt(r.beforeKm)}km`, 9) +
      col(`${fmt(r.afterKm)}km`, 9) +
      col(pct(-r.reductionPct).replace("-", "−"), 9),
  );
}
console.log("-".repeat(80));
console.log(
  `Total path: ${fmt(totalBefore)}km → ${fmt(totalAfter)}km  ` +
    `(−${overallReduction.toFixed(1)}% overall, ${meanReduction.toFixed(1)}% mean per day)`,
);
console.log(`Days improved: ${improvedDays}/${results.length}`);
console.log(`Invariant — no day got longer: ${anyRegression ? "FAIL ✗" : "PASS ✓"}`);
console.log(`Invariant — time order stays monotonic: ${anyMonotonicBreak ? "FAIL ✗" : "PASS ✓"}`);
console.log("");

// ---- markdown report ----
const lines: string[] = [];
lines.push("# Route-optimizer benchmark results");
lines.push("");
lines.push(
  "_Generated by `npm run eval` (`tools/eval/route-optimizer-eval.ts`). " +
    "Reproducible and deterministic — no API keys or network required._",
);
lines.push("");
lines.push("## What this measures");
lines.push("");
lines.push(
  "Wander's value claim is that it turns a raw LLM place-list into a route you " +
    "could actually walk. The deterministic optimizer (`trip-optimize.ts`) reorders " +
    "each day by time-of-day bucket, runs nearest-neighbor from the city center, then " +
    "2-opt segment reversal. This benchmark feeds it realistic days authored in the " +
    "**zig-zag order a raw model typically emits** (real venue coordinates for 5 cities) " +
    "and measures the straight-line path length before vs. after.",
);
lines.push("");
lines.push("Distance is measured with an **independent** haversine, not the optimizer's own.");
lines.push("");
lines.push("## Headline");
lines.push("");
lines.push(`- **Total path distance: ${fmt(totalBefore)} km → ${fmt(totalAfter)} km** ` +
  `(−${overallReduction.toFixed(1)}% overall).`);
lines.push(`- **Mean reduction per day: ${meanReduction.toFixed(1)}%.**`);
lines.push(`- **${improvedDays} of ${results.length} days improved**; the rest were left unchanged (already optimal for their time buckets).`);
lines.push(`- **Invariant — optimizer never lengthens a day:** ${anyRegression ? "❌ FAIL" : "✅ PASS"}.`);
lines.push(`- **Invariant — never reorders a later daypart before an earlier one:** ${anyMonotonicBreak ? "❌ FAIL" : "✅ PASS"}.`);
lines.push("");
lines.push("## Per-day results");
lines.push("");
lines.push("| Fixture | Day | Stops | Before | After | Reduction |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const r of results) {
  lines.push(
    `| ${r.fixture} | ${r.day} | ${r.stops} | ${fmt(r.beforeKm)} km | ${fmt(r.afterKm)} km | ${r.reductionPct.toFixed(1)}% |`,
  );
}
lines.push("");
lines.push("## How to reproduce");
lines.push("");
lines.push("```bash");
lines.push("npm run eval        # requires Node 22.6+ for TypeScript type-stripping");
lines.push("```");
lines.push("");
lines.push("## Limitations of this benchmark");
lines.push("");
lines.push(
  "- Measures **straight-line** (haversine) distance, not real street/transit travel " +
    "time. The optimizer targets straight-line closeness; actual routing is done " +
    "separately at render time (Mapbox/OSRM).",
);
lines.push(
  "- Fixtures are hand-authored to resemble typical raw-LLM zig-zag ordering. They are " +
    "representative, not a random sample of real model outputs.",
);
lines.push(
  "- It validates the **routing** layer only. Itinerary *quality* (are these the right " +
    "places?) is a separate, model-dependent question not measured here.",
);
lines.push("");

const outPath = join(__dirname, "..", "..", "docs", "eval-results.md");
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath}\n`);

if (anyRegression || anyMonotonicBreak) {
  process.exitCode = 1;
}
