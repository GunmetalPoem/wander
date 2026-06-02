# Wander — user feedback summary

_Tested with three dorm friends, each planning a trip in a city they know cold so they could judge whether Wander's output matched reality. The group-room feature was tested separately with a set of high school friends planning a trip together._

Each section ends with **→** the concrete product changes that feedback drove. Many of these are visible in the commit history (`git log`).

---

## Neil — Palo Alto / SF

Knows the area well, so he stress-tested accuracy. Wanted to describe a trip in plain words and get a day back instead of building a spreadsheet — and crucially, to edit incrementally without the whole plan regenerating. Killed a stop he'd been to a hundred times and was annoyed it came back the next day, which became the "removed stops stay dead" (never-include) behavior. Also pushed for a zero-setup SF demo so a new person sees a finished trip immediately instead of an API-key wall.

→ **chat-first input, drag-to-reorder + per-stop removal, never-include list, hardcoded SF demo.**

## Andrew — New Jersey

Foodie with a car. His main complaint was meal timing: the planner kept slotting the big lunch spot at 4pm because that's where it fell on the map — so route optimization had to respect dayparts. Driving (not walking) at home meant leg times were off, which drove the walking-vs-driving toggle and realistic pacing. Constantly wished it told him hours, cover charges, and what's actually good on the menu without fifteen open tabs.

→ **daypart-aware optimization, walking/driving mode + pace, stop-detail enrichment (hours, fees, tickets, menu).** He asked for Reddit pulls directly — parked as aspirational (OAuth client exists, no feature yet).

## Abdul — Boston

Tests in two modes: with friends, and with his mom who uses a cane. The family mode exposed the accessibility gap — needed low-walking, rest-stop, and wheelchair-friendly inputs to shape the plan, plus nearby benches/bathrooms surfaced while walking. Watches budget, so flagged daily budget and group size as the inputs that matter. Also hit the "wrong Springfield" problem, which became the city-disambiguation picker.

→ **accessibility inputs, nearby-POI surfacing, daily budget + group size, city disambiguation, map/timeline with times, weather when a date is set.**

---

## Group room — high school friends

Tested the collaborative room with a separate friend group planning a real trip. The whole feature came from watching them argue in a group chat that lost all the decisions: someone says a city, someone else counters, and nobody has a record. Wanted one shared room + join link where everyone drops in, says their own thing, and leaves — without one person filling out the form for everybody. So preferences are extracted per-person from each participant's own messages.

Conflicts were the real ask: they disagreed on city and trip length, and wanted the system to *show* the conflict with a rule rather than silently pick (latest-wins city, max-wins days/group size). Two people regenerating at once caused flickering between plans → build lock, but anyone can trigger the build.

→ **shareable room + join link, shared chat, per-person extraction, conflict reports, open build trigger + build lock.**

---

## What this validated

The recurring theme across every tester was the project's core thesis: **a raw place-list isn't a plan.** The two loudest, most independent complaints — Andrew's "lunch at 4pm" and everyone's frustration with routes that wander across town — are exactly what the deterministic [route optimizer](eval-results.md) exists to fix, and they were raised by people who hadn't seen each other's feedback. Accessibility (Abdul) and group reconciliation (the high-school group) each turned into a whole feature surface rather than a tweak. The feedback didn't just polish the product; it set the roadmap.
