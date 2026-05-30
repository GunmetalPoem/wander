"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, easeOutQuart, motion, useReducedMotion } from "./Motion";

type Props = {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export default function Accordion({
  title,
  defaultOpen = false,
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const reduce = useReducedMotion();
  return (
    <div className={`rounded-xl border border-white/8 bg-black/25 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] rounded-xl"
      >
        <span className="text-[12px] font-medium text-parchment/85 tracking-wide">
          {title}
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: "spring", stiffness: 480, damping: 30 }}
          className="text-parchment/50 text-[10px]"
        >
          ▶
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: easeOutQuart }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 pt-1 text-[12px] text-parchment/75">
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
