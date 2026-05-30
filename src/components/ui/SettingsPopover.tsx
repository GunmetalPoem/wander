"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "./Motion";

type Props = {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((state: { close: () => void }) => ReactNode);
  align?: "right" | "left";
  widthClass?: string;
};

export default function SettingsPopover({
  trigger,
  children,
  align = "right",
  widthClass = "w-80",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);
  const originClass =
    align === "right" ? "origin-top-right right-0" : "origin-top-left left-0";

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trigger({ open, toggle })}
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-modal="false"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -2 }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
            className={`absolute z-40 mt-2 ${originClass} ${widthClass} rounded-2xl border border-white/10 bg-coal/95 backdrop-blur shadow-[0_30px_80px_-30px_rgba(0,0,0,0.75)]`}
          >
            {typeof children === "function" ? children({ close }) : children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
