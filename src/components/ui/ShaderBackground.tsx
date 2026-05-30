"use client";

import dynamic from "next/dynamic";

const ShaderCanvas = dynamic(() => import("./ShaderCanvas"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="absolute inset-0 [border-radius:inherit] bg-[radial-gradient(60%_80%_at_35%_30%,rgba(52,211,153,0.18),transparent_60%),radial-gradient(50%_70%_at_75%_70%,rgba(52,211,153,0.10),transparent_60%)]"
    />
  ),
});

type Props = {
  className?: string;
  palette?: [number, number, number][];
  intensity?: "low" | "med" | "high";
};

export default function ShaderBackground({ className, palette, intensity = "med" }: Props) {
  return (
    <div
      aria-hidden
      // `[border-radius:inherit]` + own `overflow-hidden` clips the canvas to the
      // parent's rounded shape — works around the WebKit/Chromium bug where a
      // composited child escapes a `rounded-* overflow-hidden` ancestor.
      className={`pointer-events-none absolute inset-0 overflow-hidden [border-radius:inherit] [isolation:isolate] [-webkit-mask-image:linear-gradient(#000,#000)] ${className ?? ""}`}
    >
      <ShaderCanvas palette={palette} intensity={intensity} />
    </div>
  );
}
