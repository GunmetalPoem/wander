"use client";

export {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from "framer-motion";

export const springSoft = {
  type: "spring" as const,
  stiffness: 320,
  damping: 32,
  mass: 0.9,
};

export const springSnappy = {
  type: "spring" as const,
  stiffness: 520,
  damping: 36,
  mass: 0.7,
};

export const easeOutExpo = [0.16, 1, 0.3, 1] as const;
export const easeOutQuart = [0.25, 1, 0.5, 1] as const;

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.24, ease: easeOutQuart } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: easeOutQuart } },
};

export const slideUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease: easeOutQuart } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: springSnappy },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: easeOutQuart } },
};

export const staggerChildren = (delayChildren = 0, stagger = 0.06) => ({
  hidden: {},
  visible: {
    transition: {
      delayChildren,
      staggerChildren: stagger,
    },
  },
});
