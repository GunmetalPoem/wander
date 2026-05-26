"use client";

type Props = {
  message: string | null;
  onDismiss: () => void;
};

export function RoomErrorToast({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-red-500/30 bg-red-950/80 px-3 py-2 text-xs text-red-100 shadow-lg shadow-black/50 backdrop-blur">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 text-red-300">!</span>
        <p className="flex-1 leading-relaxed">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 shrink-0 rounded px-1 text-red-200/70 hover:bg-red-500/20 hover:text-red-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
