// Geist Mono woff bytes for satori, decoded from base64 strings embedded in
// fonts.data.ts (generated from the vendored ./fonts/*.woff). Embedding rather
// than reading from disk because a runtime fs read doesn't survive the Nitro/Vercel
// server build — Vite drops new URL(import.meta.url) assets and a file path isn't
// traced into the function. Plain ESM strings are always bundled. satori can't read
// the variable woff2 the app ships, hence these static weights.
import { w400, w600, w700 } from "./fonts.data";

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

let cache: SatoriFont[] | null = null;

/** Geist Mono only — the app is mono-first (--font-heading maps to the mono
 *  family), so display + labels share one typeface. Cached at module scope. */
export function ogFonts(): SatoriFont[] {
  if (cache) return cache;
  cache = [
    { name: "Geist Mono", data: Buffer.from(w400, "base64"), weight: 400, style: "normal" },
    { name: "Geist Mono", data: Buffer.from(w600, "base64"), weight: 600, style: "normal" },
    { name: "Geist Mono", data: Buffer.from(w700, "base64"), weight: 700, style: "normal" },
  ];
  return cache;
}
