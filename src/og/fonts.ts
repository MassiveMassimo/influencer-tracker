// Static woff bytes for satori (it can't read the variable woff2 we already ship).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

function read(pkg: string, file: string): Buffer {
  return readFileSync(require.resolve(`${pkg}/files/${file}`));
}

let cache: SatoriFont[] | null = null;

/** Geist Mono only — the app is mono-first (--font-heading maps to the mono
 *  family), so display + labels share one typeface. Cached at module scope. */
export function ogFonts(): SatoriFont[] {
  if (cache) return cache;
  cache = [
    { name: "Geist Mono", data: read("@fontsource/geist-mono", "geist-mono-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Geist Mono", data: read("@fontsource/geist-mono", "geist-mono-latin-600-normal.woff"), weight: 600, style: "normal" },
    { name: "Geist Mono", data: read("@fontsource/geist-mono", "geist-mono-latin-700-normal.woff"), weight: 700, style: "normal" },
  ];
  return cache;
}
