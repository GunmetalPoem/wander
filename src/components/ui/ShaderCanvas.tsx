"use client";

import { useEffect, useRef } from "react";

type Intensity = "low" | "med" | "high";

type Props = {
  className?: string;
  /** RGB triplets in 0..1; provide exactly 3 colors. */
  palette?: [number, number, number][];
  intensity?: Intensity;
};

const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  // Full-screen triangle trick: 3 verts → covers the viewport.
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = (p + 1.0) * 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uPalette[3];
uniform float uIntensity;

// Simple value noise so blobs feel organic.
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0,0.0));
  float c = hash(i + vec2(0.0,1.0));
  float d = hash(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}

vec2 blob(float t, float seed){
  // Drift each blob along a slow figure-8 path.
  float a = t * 0.18 + seed * 6.2831;
  return vec2(0.55 * sin(a * 0.9 + seed),
              0.45 * cos(a * 0.7 + seed * 1.3));
}

void main(){
  vec2 uv = vUv;
  // Aspect-correct uv around center for blob distances.
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);

  float t = uTime;

  // Three blobs, one per palette color.
  vec2 c0 = blob(t, 0.10);
  vec2 c1 = blob(t, 0.43);
  vec2 c2 = blob(t, 0.81);

  float d0 = length(p - c0);
  float d1 = length(p - c1);
  float d2 = length(p - c2);

  // Soft falloff radii — overlapping creates the aurora feel.
  float r = 0.55;
  float w0 = smoothstep(r, 0.0, d0);
  float w1 = smoothstep(r, 0.0, d1);
  float w2 = smoothstep(r, 0.0, d2);

  // Background gradient bias toward palette[1] (mid).
  vec3 bg = mix(uPalette[1], uPalette[2], smoothstep(-0.4, 0.6, uv.y));

  vec3 col = bg;
  col = mix(col, uPalette[0], w0 * 0.85);
  col = mix(col, uPalette[1], w1 * 0.55);
  col = mix(col, uPalette[0], w2 * 0.45);

  // Soft moving grain to break up banding.
  float n = noise(p * 12.0 + t * 0.15);
  col += (n - 0.5) * 0.04;

  // Vignette so edges feel composed.
  float vignette = smoothstep(1.15, 0.35, length(p));
  col *= mix(0.55, 1.0, vignette);

  // Intensity uniform pushes overall luminance + saturation.
  col = mix(uPalette[2], col, clamp(uIntensity, 0.0, 1.0));

  outColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log ?? "unknown"}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${log ?? "unknown"}`);
  }
  return p;
}

const DEFAULT_PALETTE: [number, number, number][] = [
  [52 / 255, 211 / 255, 153 / 255],
  [10 / 255, 10 / 255, 12 / 255],
  [3 / 255, 3 / 255, 3 / 255],
];

const INTENSITY_MAP: Record<Intensity, number> = {
  low: 0.55,
  med: 0.85,
  high: 1.0,
};

export default function ShaderCanvas({
  className,
  palette = DEFAULT_PALETTE,
  intensity = "med",
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      // Graceful fallback: drop a static CSS gradient via class swap.
      canvas.style.background =
        "radial-gradient(60% 80% at 35% 30%, rgba(52,211,153,0.18), transparent 60%), radial-gradient(50% 70% at 75% 70%, rgba(52,211,153,0.12), transparent 60%), #050507";
      return;
    }

    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let prog: WebGLProgram | null = null;
    try {
      vs = compile(gl, gl.VERTEX_SHADER, VERT);
      fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      prog = link(gl, vs, fs);
    } catch {
      canvas.style.background =
        "radial-gradient(60% 80% at 35% 30%, rgba(52,211,153,0.18), transparent 60%), #050507";
      return;
    }

    gl.useProgram(prog);

    const uResolution = gl.getUniformLocation(prog, "uResolution");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uPalette = gl.getUniformLocation(prog, "uPalette");
    const uIntensity = gl.getUniformLocation(prog, "uIntensity");

    const flatPalette = new Float32Array(9);
    for (let i = 0; i < 3; i++) {
      const c = palette[i] ?? DEFAULT_PALETTE[i];
      flatPalette[i * 3 + 0] = c[0];
      flatPalette[i * 3 + 1] = c[1];
      flatPalette[i * 3 + 2] = c[2];
    }
    gl.uniform3fv(uPalette, flatPalette);
    gl.uniform1f(uIntensity, INTENSITY_MAP[intensity]);

    let dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.5);
    let raf = 0;
    let start = performance.now();
    let lastResize = 0;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uResolution, w, h);
    }

    function frame(now: number) {
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (now - lastResize > 250) {
        resize();
        lastResize = now;
      }
      gl!.uniform1f(uTime, (now - start) / 1000);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    resize();
    // First paint always.
    gl.uniform1f(uTime, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce) raf = requestAnimationFrame(frame);

    const onResize = () => {
      lastResize = 0;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (prog) gl.deleteProgram(prog);
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    };
    // palette/intensity captured at mount; remount if changed.
  }, [palette, intensity]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`block h-full w-full ${className ?? ""}`}
    />
  );
}
