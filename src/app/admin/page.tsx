"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type GeoHit = { name: string; lat: number; lng: number };

type QuestRow = {
  id: string;
  slug: string;
  title: string;
  loreBlurb: string;
  category: string;
  safetyScore: number;
  status: string;
};

export default function AdminPage() {
  const [placeQuery, setPlaceQuery] = useState("");
  const [selectedGeo, setSelectedGeo] = useState<GeoHit | null>(null);
  const [geoCandidates, setGeoCandidates] = useState<GeoHit[]>([]);
  const [geoLookupBusy, setGeoLookupBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<QuestRow[]>([]);
  const geoAbortRef = useRef<AbortController | null>(null);

  const headers = useCallback(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (adminSecret.trim()) h["x-admin-secret"] = adminSecret.trim();
    return h;
  }, [adminSecret]);

  const loadDrafts = useCallback(async () => {
    const res = await fetch("/api/quests?status=draft", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { quests: QuestRow[] };
    setDrafts(data.quests);
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    const q = placeQuery.trim();
    if (q.length < 2) {
      setGeoCandidates([]);
      setGeoLookupBusy(false);
      return;
    }
    geoAbortRef.current?.abort();
    const ac = new AbortController();
    geoAbortRef.current = ac;
    const t = window.setTimeout(() => {
      void (async () => {
        setGeoLookupBusy(true);
        try {
          const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
            signal: ac.signal,
            cache: "no-store",
          });
          if (!res.ok) {
            setGeoCandidates([]);
            return;
          }
          const data = (await res.json()) as { results?: GeoHit[] };
          if (!ac.signal.aborted) setGeoCandidates(data.results ?? []);
        } catch (e) {
          if ((e as Error).name !== "AbortError") setGeoCandidates([]);
        } finally {
          if (!ac.signal.aborted) setGeoLookupBusy(false);
        }
      })();
    }, 400);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [placeQuery]);

  function onPlaceInputChange(value: string) {
    setPlaceQuery(value);
    setSelectedGeo(null);
  }

  async function runScrape() {
    setBusy(true);
    setMessage(null);
    try {
      const loc = placeQuery.trim();
      const directUrl = url.trim();
      if (loc.length > 0) {
        if (!selectedGeo) {
          setMessage("Type a place, wait for results, then pick one from the list so we use the right city or campus.");
          setBusy(false);
          return;
        }
      }
      const body =
        loc.length > 0
          ? { location: loc, geo: selectedGeo! }
          : directUrl.length > 0
            ? { url: directUrl }
            : null;
      if (!body) {
        setMessage("Enter a place name, or paste a URL under Advanced.");
        setBusy(false);
        return;
      }

      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        code?: string;
        error?: string;
        hint?: string;
        createdQuests?: { id: string; slug: string; title: string }[];
        rawScrapeId?: string;
        sources?: string[];
        usedLocation?: string;
        gather?: { redditThreads: number; webPages: number; charCount: number };
        questCompile?: { path: "strict" | "relaxed" | "stub" | "none" };
      };
      if (!res.ok) {
        const gather =
          data.gather != null
            ? ` Gathered: ${data.gather.redditThreads} Reddit thread(s), ${data.gather.webPages} web page(s), ${data.gather.charCount} chars.`
            : "";
        const hint = data.hint ? ` ${data.hint}` : "";
        setMessage(
          (data.error ?? `Error ${res.status}`) + (data.code === "no_quests_extracted" ? gather + hint : ""),
        );
        return;
      }
      const n = data.createdQuests?.length ?? 0;
      const src = data.sources?.length ? ` · ${data.sources.length} source links` : "";
      const g = data.gather
        ? ` · corpus: ${data.gather.redditThreads} Reddit / ${data.gather.webPages} web · ${data.gather.charCount} chars`
        : "";
      const compileNote =
        data.questCompile?.path === "relaxed"
          ? " · compile: relaxed pass (weaker signals in the corpus)"
          : data.questCompile?.path === "stub"
            ? " · compile: curation draft (strict+relaxed found no quest; edit from raw text)"
            : "";
      setMessage(
        `Created ${n} draft quest(s) for “${data.usedLocation ?? "URL"}”. Raw scrape: ${data.rawScrapeId ?? "—"}${src}${g}${compileNote}`,
      );
      await loadDrafts();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (typeof window !== "undefined" && !window.confirm("Delete ALL quests and raw scrapes? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/reset", { method: "POST", headers: headers() });
      const data = (await res.json()) as { error?: string; questsDeleted?: number; rawScrapesDeleted?: number };
      if (!res.ok) {
        setMessage(data.error ?? `Error ${res.status}`);
        return;
      }
      setMessage(
        `Cleared: ${data.questsDeleted ?? 0} quest(s), ${data.rawScrapesDeleted ?? 0} raw scrape(s).`,
      );
      await loadDrafts();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function publish(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/quests/publish?id=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: headers(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? `Error ${res.status}`);
        return;
      }
      setMessage("Published.");
      await loadDrafts();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-serif text-3xl text-parchment">Wander Lab</h1>
        <p className="mt-2 max-w-2xl text-sm text-parchment/70">
          Type any place — city, neighborhood, or school name. The server runs targeted Reddit and DuckDuckGo queries
          (not made-up URLs), fetches the threads and pages it finds, and ranks them for relevance. It skips Wikipedia
          bodies and a lot of travel/SEO sites. If the AI finds nothing that clearly fits strict quest rules, you get zero
          drafts but a raw scrape is kept for inspection. Open-Meteo geocodes the name (no key). Clear the place field
          and use Advanced to scrape a single URL instead. You must **confirm** the place from the search
          list so the geocoder does not attach the wrong area (e.g. Stanford, CA vs. Stanford elsewhere).
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-5">
        <label className="block text-xs uppercase tracking-wide text-parchment/50">Search place (confirm below)</label>
        <input
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-parchment outline-none ring-ember/40 focus:ring-2"
          value={placeQuery}
          onChange={(e) => onPlaceInputChange(e.target.value)}
          placeholder="e.g. Stanford, Mission District, Austin"
          autoComplete="off"
        />
        {placeQuery.trim().length >= 2 && (
          <div className="space-y-2">
            <p className="text-[11px] text-parchment/50">
              {geoLookupBusy ? "Looking up…" : "Pick the row that matches your place."}
            </p>
            {geoCandidates.length > 0 ? (
              <select
                className="w-full rounded-xl border border-ember/30 bg-black/50 px-3 py-2 text-sm text-parchment outline-none focus:ring-2 focus:ring-ember/40"
                value={selectedGeo ? selectedGeo.name : ""}
                onChange={(e) => {
                  const name = e.target.value;
                  const hit = geoCandidates.find((c) => c.name === name);
                  setSelectedGeo(hit ?? null);
                }}
                aria-label="Confirm place from geocoder"
              >
                <option value="">— Select a place —</option>
                {geoCandidates.map((c) => (
                  <option key={`${c.name}-${c.lat}-${c.lng}`} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : !geoLookupBusy ? (
              <p className="text-xs text-parchment/50">No matches. Try a fuller name (e.g. “Stanford University”).</p>
            ) : null}
          </div>
        )}
        {selectedGeo && (
          <p className="rounded-lg border border-moss/30 bg-moss/10 px-3 py-2 text-xs text-parchment/90">
            <span className="font-medium text-moss">Confirmed:</span> {selectedGeo.name}
            <button
              type="button"
              className="ml-3 text-parchment/60 underline decoration-dotted hover:text-parchment"
              onClick={() => setSelectedGeo(null)}
            >
              Change
            </button>
          </p>
        )}

        <details className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-parchment/50">
            Advanced: paste one URL instead
          </summary>
          <p className="mt-2 text-xs text-parchment/55">
            If this field is filled and the place field is empty, Lab scrapes only that page (old behavior).
          </p>
          <input
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-parchment outline-none ring-ember/40 focus:ring-2"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </details>

        <label className="mt-4 block text-xs uppercase tracking-wide text-parchment/50">
          Admin secret (optional — required if <code className="text-parchment/80">ADMIN_SECRET</code> is set in{" "}
          <code className="text-parchment/80">.env</code>)
        </label>
        <input
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-parchment outline-none ring-ember/40 focus:ring-2"
          type="password"
          autoComplete="off"
          value={adminSecret}
          onChange={(e) => setAdminSecret(e.target.value)}
          placeholder="Leave empty for local demo without ADMIN_SECRET"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runScrape()}
            className="rounded-full bg-ember px-5 py-2 text-sm font-medium text-white transition hover:bg-orange-600 disabled:opacity-50"
          >
            {busy ? "Working…" : "Gather sources for this place + parse with AI"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void clearAll()}
            className="rounded-full border border-red-500/50 px-4 py-2 text-sm text-red-200/90 transition hover:bg-red-950/50 disabled:opacity-50"
          >
            Clear all data
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-parchment/80 whitespace-pre-wrap">{message}</p>}
      </div>

      <section className="space-y-3">
        <h2 className="font-serif text-xl text-parchment">Draft quests</h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-parchment/60">No drafts yet.</p>
        ) : (
          <ul className="space-y-3">
            {drafts.map((q) => (
              <li
                key={q.id}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-parchment">{q.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-parchment/60">{q.loreBlurb}</p>
                  <p className="mt-2 text-[11px] text-parchment/45">
                    {q.category} · risk {q.safetyScore}/5
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-parchment/80 hover:bg-white/10"
                    href={`/quests/${q.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open draft
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void publish(q.id)}
                    className="rounded-full bg-moss px-3 py-1 text-xs font-medium text-white hover:bg-emerald-900 disabled:opacity-50"
                  >
                    Publish
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-parchment/45">
          Drafts open on their URL for preview; the home feed only lists published quests.
        </p>
      </section>
    </div>
  );
}
