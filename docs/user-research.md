# User research — personas, interview guide & design hypotheses

> **Status & honesty note.** This document contains **design personas, a ready-to-run interview guide, and *anticipated* feedback** used to reason about the product. The personas and the "anticipated reactions" below are **illustrative design hypotheses — they are NOT transcripts of interviews that have been conducted.** No formal user study has been run yet. This file is the *instrument* for running one, plus an honest record of the design thinking that shaped the build. Where a design decision was actually made, it is tied to the real commit history. Please don't read the quotes as collected data — they're projected reactions written to pressure-test the design.

---

## 1. Who Wander is for (target personas)

These three personas were written up-front to focus scope. They're composites of the kinds of travelers the product targets, not real individuals.

### Persona A — "The over-researcher" (solo / couple)
- **Profile:** Plans a 3–5 day city trip 2–3× a year. Opens 20 browser tabs, makes a Google Doc, cross-checks every place against a map.
- **Pain:** "I get a great list from ChatGPT but then I spend an hour figuring out what's actually near what, and half of it is across town."
- **What success looks like for them:** A plan where each day is already geographically sane and they can just tweak it.

### Persona B — "The group organizer" (friends / family trip)
- **Profile:** Becomes the de-facto trip planner because no one else will. Juggles a group chat where everyone wants different things.
- **Pain:** "Reconciling five people's preferences into one itinerary is a part-time job, and someone's always unhappy."
- **What success looks like for them:** Everyone contributes their own preferences; one coherent plan comes out; no one feels ignored.

### Persona C — "The constrained traveler" (accessibility / low-mobility needs)
- **Profile:** Travels with a wheelchair user, or a parent who tires easily, or small kids.
- **Pain:** "Generic itineraries assume I can walk 6 miles and climb to every viewpoint. I have to manually vet everything."
- **What success looks like for them:** Plans that respect walking limits, rest stops, and step-free access from the start.

---

## 2. Interview guide (ready to run)

A ~20-minute semi-structured guide. The goal is to learn, not to sell — open questions first, the product second.

**Warm-up (context, no product yet)**
1. Tell me about the last city trip you planned. Walk me through what you actually did, tool by tool.
2. What was the most annoying part of that process?
3. (If a group trip) How did you decide what everyone did each day?

**Problem probing**
4. When you get an itinerary from an AI or a blog, what do you trust and what do you immediately double-check?
5. Have you ever followed a plan that had you crossing the city back and forth? What happened?
6. (Accessibility, if relevant) How do you currently check whether places work for your group's needs?

**Reaction to Wander (show the SF demo, then a live generation)**
7. First impression — what is this, in your words?
8. Generate a trip for a city you know well. Are these real places? Is the *order* something you'd actually do?
9. Show the timeline + map. Does seeing the route change how much you trust the plan?
10. (Group rooms) Here's a shareable link with separate columns per person. Would your group use this over a group chat? Why / why not?

**Close**
11. What would stop you from using this for your next trip?
12. What's missing that you expected to be here?
13. If this cost money, what would make it worth paying for?

**What we'd measure:** task success (did they get a usable plan?), trust delta before/after seeing the map, time-to-first-usable-plan, and unprompted mentions of geography/ordering (the core thesis).

---

## 3. Design hypotheses & anticipated objections

These are **predictions** to be validated/falsified by the interviews above. Written honestly as hypotheses, with the riskiest ones first.

| # | Hypothesis | Why we believe it | How we'd know we're wrong |
| --- | --- | --- | --- |
| H1 | Seeing the route on a map increases trust more than better prose | Persona A's pain is geography, not description | Users skip the map and read the text list instead |
| H2 | Groups will adopt per-person preference columns over a group chat | Reconciliation is the stated pain for Persona B | Users find the room confusing or just paste everything into one column |
| H3 | Day-by-day streaming reduces perceived wait enough to matter | A 30s blank wait feels broken; incremental feels alive | Users don't notice or are annoyed by partial plans |
| H4 | Accessibility toggles are a deciding feature for Persona C, ignorable noise for others | It's a hard requirement for some, irrelevant for most | Persona C still hand-vets everything; others are confused by the options |
| H5 | "Real, verifiable places" matters more than "hidden gems" | Trust is the gate to use | Users want surprising picks more than correct ones |

**Anticipated objections (illustrative — to be confirmed):**
- *"How do I know these places are still open / accurate?"* → motivates the on-demand **deep stop details** (hours/price/website) feature.
- *"I want to swap one stop without regenerating everything."* → motivates **drag-to-reorder** + the chat-patch model (edit the form conversationally).
- *"Our group can't agree on budget."* → a known gap; the merge combines preferences but doesn't negotiate hard trade-offs (see README §3 limitations).

---

## 4. How real product decisions mapped to this thinking

Unlike the projected feedback above, the following **did happen** and are visible in `git log` / the codebase. They're included so the design reasoning connects to actual iteration.

- **Scope was deliberately narrowed.** An early "quest feed" and "lab" direction was **cut** (`16a2b2b — "drop quest feed & lab"`) to focus entirely on the trip-planner thesis (H1). Doing fewer things, better.
- **Accessibility became first-class** (`9bbdf4e`), reflecting Persona C / H4 — wheelchair, low-walking, and rest-stop preferences are now baked into the planning prompt rather than bolted on.
- **Group rooms were built** (`841be81`) to test H2 directly — per-participant columns, each with its own assistant, merged into one draft.
- **Day-by-day streaming** (`ca1c778`) was added to address H3 — days now appear on the map as they generate instead of after one long wait.
- **The route optimizer was fixed by its own benchmark.** Building the evaluation harness ([`docs/eval-results.md`](eval-results.md)) falsified the assumption that the optimizer never lengthens a day; the fix followed. This is the clearest example of evidence changing the product — see README §3.

---

## 5. What would make this real (next steps)

To convert this from design reasoning into genuine evaluation evidence:
1. Run the §2 guide with **3–5 people per persona** (recruit from friends who travel + one accessibility-needs participant).
2. Record trust-delta and time-to-usable-plan as defined above.
3. Replace the "anticipated feedback" in §3 with **labeled, dated, real quotes** and note which hypotheses were confirmed or killed.
4. Log resulting product changes here, the same way §4 logs the ones made so far.
