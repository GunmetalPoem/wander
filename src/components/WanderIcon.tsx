import { Waypoints, type LucideProps } from "lucide-react";

/** Brand mark — Lucide Waypoints (itinerary stops + route). */
export function WanderIcon({ className, size = 24, strokeWidth = 2, ...props }: LucideProps) {
  return (
    <Waypoints
      size={size}
      strokeWidth={strokeWidth}
      className={className ?? "shrink-0 text-wander"}
      aria-hidden
      {...props}
    />
  );
}
