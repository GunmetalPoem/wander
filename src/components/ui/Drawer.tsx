"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, easeOutExpo, motion, useReducedMotion } from "./Motion";

type Props = {
  open: boolean;
  onClose: () => void;
  side?: "right" | "bottom";
  widthClass?: string;
  children: ReactNode;
  labelledBy?: string;
};

export default function Drawer({
  open,
  onClose,
  side = "right",
  widthClass = "max-w-md",
  children,
  labelledBy,
}: Props) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (typeof window === "undefined") return null;

  const offAxisInitial =
    side === "right"
      ? { x: "100%" }
      : { y: "100%" };
  const offAxisEnter = side === "right" ? { x: 0 } : { y: 0 };

  const positionClass =
    side === "right"
      ? `right-0 top-0 h-full w-full ${widthClass}`
      : `left-0 right-0 bottom-0 max-h-[88vh] w-full`;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[65]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={`absolute ${positionClass} bg-coal border-l border-white/10 shadow-[0_30px_120px_-30px_rgba(0,0,0,0.85)] overflow-hidden`}
            initial={reduce ? { opacity: 0 } : offAxisInitial}
            animate={reduce ? { opacity: 1 } : offAxisEnter}
            exit={reduce ? { opacity: 0 } : offAxisInitial}
            transition={{ duration: 0.32, ease: easeOutExpo }}
          >
            {children}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
