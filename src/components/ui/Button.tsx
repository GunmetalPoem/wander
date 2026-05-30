"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "./Motion";

type Variant = "primary" | "ghost" | "icon" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  shimmer?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const base =
  "relative inline-flex items-center justify-center gap-1.5 font-medium tracking-wide select-none whitespace-nowrap rounded-xl border focus:outline-none focus-visible:ring-2 focus-visible:ring-wander/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 ease-out-quart overflow-hidden";

const variants: Record<Variant, string> = {
  primary:
    "border-wander/40 bg-wander text-ink hover:bg-wander/95 shadow-[0_8px_30px_-12px_rgba(52,211,153,0.55)]",
  ghost:
    "border-white/10 bg-white/[0.04] text-parchment/85 hover:bg-white/[0.07] hover:border-white/15",
  icon: "border-white/10 bg-white/[0.04] text-parchment/80 hover:bg-white/[0.08] hover:text-parchment p-0",
  danger:
    "border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/15 hover:border-red-500/45",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-10 px-4 text-[13px]",
  lg: "h-12 px-5 text-sm",
};

const iconSizes: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
};

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "ghost",
    size = "md",
    shimmer = false,
    loading = false,
    leftIcon,
    rightIcon,
    children,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const sizeClass = variant === "icon" ? iconSizes[size] : sizes[size];
  return (
    <motion.button
      ref={ref}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      whileHover={reduce ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      disabled={disabled || loading}
      {...(rest as object)}
      className={[base, variants[variant], sizeClass, className ?? ""].join(" ")}
    >
      {shimmer ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 shimmer-surface animate-shimmer opacity-70"
        />
      ) : null}
      {loading ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 rounded-full border-2 border-current/40 border-t-current animate-spin"
        />
      ) : leftIcon ? (
        <span className="shrink-0 inline-flex">{leftIcon}</span>
      ) : null}
      {children ? <span className="relative">{children}</span> : null}
      {rightIcon ? <span className="shrink-0 inline-flex">{rightIcon}</span> : null}
    </motion.button>
  );
});

export default Button;
