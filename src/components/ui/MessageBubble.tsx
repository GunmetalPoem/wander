"use client";

import type { ReactNode } from "react";
import { motion, springSoft, useReducedMotion } from "./Motion";

type Props = {
  side: "left" | "right";
  children: ReactNode;
  className?: string;
};

export default function MessageBubble({ side, children, className }: Props) {
  const reduce = useReducedMotion();
  const justify = side === "right" ? "justify-end" : "justify-start";
  return (
    <motion.div
      layout="position"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={springSoft}
      className={`flex ${justify} ${className ?? ""}`}
    >
      {children}
    </motion.div>
  );
}
