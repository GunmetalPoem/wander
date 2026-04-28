"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TripFormInput } from "@/lib/trip-schema";

const DEBOUNCE_MS = 450;

type Props = {
  value: TripFormInput;
  onChange: (v: TripFormInput) => void;
};

export function CityConfirmField({ value, onChange }: Props) {
  const [candidates, setCandidates] = useState<{ id: string; label: string; lat: number; lng: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectId, setSelectId] = useState<string>("");
  const debounceRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const commit = useCallback(
    (patch: Pick<TripFormInput, "city" | "cityCenter" | "cityLocationReady">) => {
      onChange({ ...valueRef.current, ...patch });
    },
    [onChange],
  );

  const q = value.city;

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const query = valueRef.current.city.trim();
      void (async () => {
        if (query.length < 2) {
          setCandidates([]);
          setSelectId("");
          commit({ city: query, cityCenter: null, cityLocationReady: true });
          return;
        }
        setLoading(true);
        try {
          const res = await fetch(`/api/trip/city-candidates?query=${encodeURIComponent(query)}`);
          const data = (await res.json()) as { candidates: { id: string; label: string; lat: number; lng: number }[] };
          const c = data.candidates ?? [];
          setCandidates(c);
          if (c.length === 1) {
            const only = c[0]!;
            setSelectId(only.id);
            commit({
              city: only.label,
              cityCenter: { lat: only.lat, lng: only.lng },
              cityLocationReady: true,
            });
          } else if (c.length > 1) {
            setSelectId("");
            commit({ city: query, cityCenter: null, cityLocationReady: false });
          } else {
            setSelectId("");
            commit({ city: query, cityCenter: null, cityLocationReady: true });
          }
        } catch {
          setCandidates([]);
          setSelectId("");
          commit({ city: query, cityCenter: null, cityLocationReady: true });
        } finally {
          setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, commit]);

  const onSelectChange = (id: string) => {
    setSelectId(id);
    if (!id) {
      commit({ city: valueRef.current.city, cityCenter: null, cityLocationReady: false });
      return;
    }
    const c = candidates.find((x) => x.id === id);
    if (c) {
      commit({ city: c.label, cityCenter: { lat: c.lat, lng: c.lng }, cityLocationReady: true });
    }
  };

  const needPick = candidates.length > 1 && !value.cityCenter;
  const selectValue =
    selectId ||
    (value.cityCenter
      ? candidates.find((c) => c.lat === value.cityCenter!.lat && c.lng === value.cityCenter!.lng)?.id ?? ""
      : "");

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs text-parchment/50">City</label>
        <input
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-parchment outline-none focus:border-ember/60"
          value={value.city}
          onChange={(e) => {
            onChange({ ...value, city: e.target.value, cityCenter: null, cityLocationReady: false });
            setSelectId("");
          }}
          placeholder="e.g. Portland or Springfield"
          autoComplete="off"
        />
        {loading && <p className="mt-0.5 text-[10px] text-parchment/40">Looking up places…</p>}
      </div>

      {candidates.length > 1 && (
        <div>
          <label className="text-xs text-parchment/50">Confirm location (state / region)</label>
          <select
            className="mt-1 w-full rounded-lg border border-amber-500/25 bg-black/50 px-2 py-2 text-sm text-parchment"
            value={selectValue}
            onChange={(e) => onSelectChange(e.target.value)}
          >
            <option value="">— Choose the right city —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {needPick && (
            <p className="mt-1 text-[10px] text-amber-200/80">
              Several places share that name. Choose the one you mean so the trip is planned in the right place.
            </p>
          )}
        </div>
      )}

      {candidates.length === 1 && !loading && (
        <p className="text-[10px] text-parchment/45">Location matched to that place name.</p>
      )}

      {candidates.length === 0 && !loading && q.trim().length >= 2 && (
        <p className="text-[10px] text-parchment/50">
          No quick matches. You can still generate — the server will guess the city from the name.
        </p>
      )}
    </div>
  );
}
