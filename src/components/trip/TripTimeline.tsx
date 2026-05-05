"use client";

import { useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TripStop } from "@/lib/trip-schema";
import type { ScheduledStop } from "@/lib/trip-time";
import { mapboxStopThumbnailUrl } from "@/lib/mapbox-static-thumb";

const AVATAR_PALETTES = [
  "bg-teal-950/85 text-teal-100 ring-1 ring-teal-400/20",
  "bg-indigo-950/85 text-indigo-100 ring-1 ring-indigo-400/20",
  "bg-emerald-950/80 text-emerald-100 ring-1 ring-emerald-400/25",
  "bg-rose-950/85 text-rose-100 ring-1 ring-rose-400/20",
  "bg-cyan-950/85 text-cyan-100 ring-1 ring-cyan-400/20",
  "bg-violet-950/85 text-violet-100 ring-1 ring-violet-400/20",
] as const;

function stopInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
  if (parts.length >= 2) {
    const a = alnum(parts[0]!).charAt(0);
    const b = alnum(parts[1]!).charAt(0);
    if (a && b) return (a + b).toUpperCase();
  }
  const w = alnum(parts[0] ?? name);
  if (w.length >= 2) return w.slice(0, 2).toUpperCase();
  if (w.length === 1) return (w + w).toUpperCase();
  return "??";
}

function avatarClassForStop(stop: TripStop): string {
  const key = stop.category ?? stop.name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

function hasCoords(s: TripStop): boolean {
  return (
    s.lat != null &&
    s.lng != null &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng)
  );
}

function locationWarningText(s: TripStop): string | null {
  const parts: string[] = [];
  if (!hasCoords(s)) parts.push("Location not on map — place could not be matched.");
  if (
    hasCoords(s) &&
    s.locationConfidence != null &&
    s.locationConfidence < 0.6
  ) {
    parts.push("Location approximate — name match was weak.");
  }
  return parts.length ? parts.join(" ") : null;
}

function StopFace({ stop, mapboxToken }: { stop: TripStop; mapboxToken: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const token = mapboxToken.trim();
  if (
    !imgFailed &&
    token &&
    typeof stop.lng === "number" &&
    typeof stop.lat === "number" &&
    Number.isFinite(stop.lng) &&
    Number.isFinite(stop.lat)
  ) {
    const url = mapboxStopThumbnailUrl(token, stop.lng, stop.lat);
    if (url) {
      return (
        <div
          className="relative mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-full ring-1 ring-white/12"
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Mapbox static API; avoid next/image remote config churn */}
          <img
            src={url}
            alt=""
            width={128}
            height={128}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        </div>
      );
    }
  }
  return (
    <div
      className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tracking-tight ${avatarClassForStop(stop)}`}
      aria-hidden
    >
      {stopInitials(stop.name)}
    </div>
  );
}

function SortableRow({
  id,
  selected,
  children,
}: {
  id: string;
  selected: boolean;
  children: (handle: { attributes: object; listeners: object | undefined }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.88 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border transition-[box-shadow,border-color,background-color,opacity] ${
        selected
          ? "border-wander/50 bg-wander-muted/25 shadow-[0_0_0_1px_rgba(120,210,160,0.2),0_0_28px_-10px_rgba(120,210,160,0.4)]"
          : "border-white/[0.06] bg-black/40 hover:border-white/[0.1]"
      } ${isDragging ? "shadow-lg" : ""}`}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

function TimelineSkeleton({ count }: { count: number }) {
  const n = Math.min(Math.max(count, 3), 12);
  return (
    <div className="space-y-2 pr-1" aria-busy="true" aria-live="polite" aria-label="Refreshing stops">
      <div className="mb-0.5 flex items-center gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-wander">
        <span
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-wander/20 border-t-wander"
          aria-hidden
        />
        Refreshing stops…
      </div>
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-3 py-2.5"
        >
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-white/[0.08]" />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <div className="h-3 w-[min(72%,200px)] animate-pulse rounded-full bg-white/[0.1]" />
            <div className="h-2.5 w-[min(48%,120px)] animate-pulse rounded-full bg-white/[0.06]" />
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="h-7 w-7 animate-pulse rounded-lg bg-white/[0.06]" />
            <div className="h-7 w-7 animate-pulse rounded-lg bg-white/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}

type Props = {
  dayNumbers: number[];
  activeDay: number;
  onDayChange: (d: number) => void;
  scheduled: ScheduledStop[];
  onReorder: (reordered: TripStop[]) => void;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  onExpandStop: (id: string) => void;
  onDeleteStop?: (id: string) => void;
  /** Mapbox token for small static-map thumbnails at each stop (same as map). */
  mapboxAccessToken?: string;
  /** True while a new plan is loading but an existing plan is still shown (chat update / rebuild). */
  isRefreshing?: boolean;
};

export function TripTimeline({
  dayNumbers,
  activeDay,
  onDayChange,
  scheduled,
  onReorder,
  selectedStopId,
  onSelectStop,
  onExpandStop,
  onDeleteStop,
  mapboxAccessToken = "",
  isRefreshing = false,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const ids = scheduled.map((s) => s.stop.id);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    const byId = new Map(scheduled.map((s) => [s.stop.id, s.stop] as const));
    const reordered = newIds.map((id) => byId.get(id)!).filter(Boolean) as TripStop[];
    onReorder(reordered);
  };

  const skeletonCount = Math.max(scheduled.length, 4);

  return (
    <div className="flex flex-col gap-2">
      {dayNumbers.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {dayNumbers.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDayChange(d)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                d === activeDay ? "bg-wander/25 text-wander ring-1 ring-wander/35" : "bg-white/5 text-parchment/75 hover:bg-white/10"
              }`}
            >
              Day {d}
            </button>
          ))}
        </div>
      )}
      {isRefreshing ? (
        <TimelineSkeleton count={skeletonCount} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2 pr-1">
              {scheduled.map((row, i) => {
                const warn = locationWarningText(row.stop);
                const metaBits: string[] = [
                  `${row.arrivalLabel}–${row.departLabel}`,
                  row.stop.category ?? "",
                  row.travelMinsToNext != null && i < scheduled.length - 1
                    ? `+~${row.travelMinsToNext}m`
                    : "",
                ].filter(Boolean);
                const hoursLine =
                  row.stop.details?.openingHoursText?.length && row.stop.details.openingHoursText[0]
                    ? row.stop.details.openingHoursText[0]
                    : "";
                const cuisine = row.stop.details?.cuisine ?? "";

                return (
                  <li key={row.stop.id} className="list-none">
                    <SortableRow id={row.stop.id} selected={selectedStopId === row.stop.id}>
                      {({ attributes, listeners }) => (
                        <div className="relative flex min-h-[4.5rem] items-start gap-1.5 p-2.5 pl-1">
                          <button
                            type="button"
                            className="relative z-20 mt-0 flex w-4 shrink-0 cursor-grab touch-manipulation items-start justify-center rounded-sm px-0.5 pb-1 pt-2 text-white/90 opacity-95 hover:text-white hover:opacity-100 active:cursor-grabbing"
                            aria-label="Drag to reorder"
                            {...attributes}
                            {...listeners}
                          >
                            <span className="grid grid-cols-2 gap-x-[2px] gap-y-[2px]" aria-hidden>
                              {Array.from({ length: 6 }, (_, i) => (
                                <span
                                  key={i}
                                  className="h-[3px] w-[3px] shrink-0 rounded-full bg-current ring-[0.35px] ring-white/35"
                                />
                              ))}
                            </span>
                          </button>
                          <div className="relative min-h-0 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => onSelectStop(row.stop.id)}
                              aria-pressed={selectedStopId === row.stop.id}
                              aria-label={`Show ${row.stop.name} on map`}
                              className="absolute inset-0 z-0 rounded-xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-coal"
                            />
                            <div className="relative z-[1] flex min-h-[4rem] items-start gap-2 py-2 pl-1 pr-[5.25rem] pointer-events-none">
                              <StopFace stop={row.stop} mapboxToken={mapboxAccessToken} />
                              <div className="min-w-0 flex-1 py-0.5">
                                <span
                                  className={`block truncate text-[13px] font-semibold leading-tight ${
                                    selectedStopId === row.stop.id ? "text-wander" : "text-parchment"
                                  }`}
                                >
                                  {row.stop.name}
                                </span>
                                <p className="mt-0.5 line-clamp-1 text-[10px] leading-snug text-parchment/45">
                                  {metaBits.join(" · ")}
                                </p>
                                {row.stop.address ? (
                                  <p className="mt-0.5 line-clamp-1 text-[10px] text-parchment/38">{row.stop.address}</p>
                                ) : null}
                                {(cuisine || hoursLine) ? (
                                  <p className="mt-0.5 line-clamp-1 text-[10px] text-parchment/40">
                                    {[cuisine ? cuisine : null, hoursLine].filter(Boolean).join(" · ")}
                                  </p>
                                ) : null}
                                {row.stop.description ? (
                                  <p className="mt-1 line-clamp-1 text-[11px] leading-snug text-parchment/55">
                                    {row.stop.description}
                                  </p>
                                ) : null}
                                {warn ? (
                                  <p className="mt-1 line-clamp-2 text-[10px] text-mist/90" title={warn}>
                                    {warn}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => onExpandStop(row.stop.id)}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.12] bg-black/55 text-parchment/75 shadow-sm backdrop-blur-sm transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-parchment"
                                aria-label="More details"
                                title="More details"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M6 9l6 6 6-6" />
                                </svg>
                              </button>
                              {onDeleteStop ? (
                                <button
                                  type="button"
                                  onClick={() => onDeleteStop(row.stop.id)}
                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/25 bg-black/55 text-red-300/90 shadow-sm backdrop-blur-sm transition-colors hover:border-red-400/45 hover:bg-red-950/40 hover:text-red-200"
                                  aria-label={`Remove ${row.stop.name} from this day`}
                                  title="Remove stop from this day"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                    <path d="M3 6h18M8 6V4h8v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12zM10 11v6M14 11v6" />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}
                    </SortableRow>
                  </li>
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
