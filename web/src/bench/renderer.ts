/**
 * Names the graphics renderer the bench ran on (S24, R3.12, O-260).
 *
 * Mechanism: a throwaway WebGL context reports UNMASKED_RENDERER_WEBGL through the
 * WEBGL_debug_renderer_info extension when the browser exposes it, else the plain RENDERER
 * string. Headless Chromium without a usable GPU falls back to SwiftShader (or llvmpipe on
 * Linux), and canvas timings there are pessimistic, so the report says which one measured.
 */
import type { RendererInfo, RendererKind } from "./bench-api.js";

const SOFTWARE_MARKERS = ["swiftshader", "llvmpipe", "software"];

export function classifyRenderer(renderer: string | null): RendererKind {
  if (renderer === null) return "unknown";
  const lower = renderer.toLowerCase();
  return SOFTWARE_MARKERS.some((marker) => lower.includes(marker)) ? "software" : "gpu";
}

function rendererString(gl: WebGLRenderingContext): string | null {
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const value: unknown = gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL);
  return typeof value === "string" && value !== "" ? value : null;
}

export function detectRenderer(doc: Document): RendererInfo {
  const gl = doc.createElement("canvas").getContext("webgl");
  const string = gl === null ? null : rendererString(gl);
  return { string, kind: classifyRenderer(string) };
}
