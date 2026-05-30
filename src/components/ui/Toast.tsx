"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "./Motion";

type ToastKind = "info" | "success" | "error";

type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
};

type ToastApi = {
  show: (message: string, opts?: { kind?: ToastKind; duration?: number }) => void;
  info: (message: string, ms?: number) => void;
  success: (message: string, ms?: number) => void;
  error: (message: string, ms?: number) => void;
  dismiss: (id: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      show: () => undefined,
      info: () => undefined,
      success: () => undefined,
      error: () => undefined,
      dismiss: () => undefined,
    };
  }
  return ctx;
}

const kindStyles: Record<ToastKind, string> = {
  info: "border-white/15 bg-coal/95 text-parchment",
  success:
    "border-wander/45 bg-[rgba(52,211,153,0.10)] text-wander shadow-[0_0_36px_-12px_rgba(52,211,153,0.55)]",
  error: "border-red-500/35 bg-red-950/85 text-red-100",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (message, opts) => {
      const id = `t-${++idRef.current}`;
      const item: ToastItem = {
        id,
        message,
        kind: opts?.kind ?? "info",
        duration: opts?.duration ?? 4000,
      };
      setItems((prev) => [...prev, item]);
      if (item.duration > 0) {
        window.setTimeout(() => dismiss(id), item.duration);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (m, ms) => show(m, { kind: "info", duration: ms }),
      success: (m, ms) => show(m, { kind: "success", duration: ms }),
      error: (m, ms) => show(m, { kind: "error", duration: ms ?? 5200 }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  // Avoid hydration mismatch — viewport only renders client-side
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.8 }}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] backdrop-blur shadow-lg ${kindStyles[t.kind]}`}
            role="status"
          >
            <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded-full px-1.5 text-current/60 hover:text-current"
              aria-label="Dismiss"
            >
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
