"use client";

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

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handle: { attributes: object; listeners: object | undefined }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-white/10 bg-black/30">
      {children({ attributes, listeners })}
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
};

export function TripTimeline({
  dayNumbers,
  activeDay,
  onDayChange,
  scheduled,
  onReorder,
  selectedStopId,
  onSelectStop,
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

  return (
    <div className="flex flex-col gap-2">
      {dayNumbers.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {dayNumbers.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDayChange(d)}
              className={`rounded-full px-3 py-1 text-xs ${
                d === activeDay ? "bg-ember/80 text-white" : "bg-white/5 text-parchment/80"
              }`}
            >
              Day {d}
            </button>
          ))}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2 pr-1">
            {scheduled.map((row, i) => (
              <li key={row.stop.id} className="list-none">
                <SortableRow id={row.stop.id}>
                  {({ attributes, listeners }) => (
                    <div className="flex gap-2 p-2">
                      <button
                        type="button"
                        className="mt-0.5 h-7 cursor-grab touch-manipulation text-parchment/30 hover:text-ember active:cursor-grabbing"
                        aria-label="Drag to reorder"
                        {...attributes}
                        {...listeners}
                      >
                        ⋮⋮
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-[10px] text-parchment/50">
                            {row.arrivalLabel} – {row.departLabel}
                          </span>
                          <span className="shrink-0 text-[10px] text-ember/90">Stop {i + 1}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectStop(row.stop.id)}
                          className={`w-full text-left text-sm font-medium ${
                            selectedStopId === row.stop.id ? "text-ember" : "text-parchment"
                          }`}
                        >
                          {row.stop.name}
                        </button>
                        <p className="line-clamp-2 text-xs text-parchment/55">{row.stop.address}</p>
                        {row.travelMinsToNext != null && i < scheduled.length - 1 && (
                          <p className="mt-1 text-[10px] text-parchment/40">
                            +~{row.travelMinsToNext} min travel to next
                          </p>
                        )}
                        <p className="mt-1 line-clamp-2 text-xs text-parchment/60">{row.stop.description}</p>
                      </div>
                    </div>
                  )}
                </SortableRow>
              </li>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
