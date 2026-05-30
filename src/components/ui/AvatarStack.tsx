"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "./Motion";

export type AvatarItem = {
  id: string;
  initials: string;
  color: string;
  label: string;
  stale?: boolean;
  isSelf?: boolean;
};

type Props = {
  items: AvatarItem[];
  max?: number;
  size?: "sm" | "md";
};

const sizeClasses = {
  sm: { ring: "h-7 w-7 text-[10px]", overflow: "h-7 px-2 text-[10px]" },
  md: { ring: "h-8 w-8 text-[11px]", overflow: "h-8 px-2.5 text-[11px]" },
};

export default function AvatarStack({ items, max = 4, size = "sm" }: Props) {
  const visible = items.slice(0, max);
  const overflow = items.slice(max);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const s = sizeClasses[size];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrap.current) return;
      if (!wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative flex items-center" ref={wrap}>
      <div className="flex items-center -space-x-2">
        <AnimatePresence initial={false}>
          {visible.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              transition={{ type: "spring", stiffness: 520, damping: 30, mass: 0.7 }}
              title={item.label}
              className={`${s.ring} inline-flex items-center justify-center rounded-full ring-2 ring-coal font-semibold text-ink ${item.stale ? "opacity-50" : ""}`}
              style={{ backgroundColor: item.color }}
            >
              {item.initials}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {overflow.length > 0 ? (
        <>
          <motion.button
            type="button"
            whileTap={reduce ? undefined : { scale: 0.95 }}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`ml-2 ${s.overflow} inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] text-parchment/85 hover:bg-white/[0.08] transition-colors`}
          >
            +{overflow.length}
          </motion.button>
          <AnimatePresence>
            {open ? (
              <motion.div
                role="dialog"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
                className="absolute right-0 top-full mt-2 z-30 w-56 rounded-xl border border-white/10 bg-coal/95 backdrop-blur shadow-xl p-2"
              >
                <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-parchment/40">
                  In this room
                </p>
                <ul className="flex flex-col">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                      <span
                        className="h-5 w-5 inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-ink"
                        style={{ backgroundColor: item.color }}
                      >
                        {item.initials}
                      </span>
                      <span className="text-xs text-parchment/85 truncate">
                        {item.label}
                        {item.isSelf ? (
                          <span className="text-parchment/40"> (you)</span>
                        ) : null}
                      </span>
                      {item.stale ? (
                        <span className="ml-auto text-[10px] text-parchment/40">away</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </div>
  );
}
