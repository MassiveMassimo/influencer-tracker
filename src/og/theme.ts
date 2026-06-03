// OG color tokens lifted from src/styles.css (:root / .dark). Hex only — satori/resvg
// don't resolve CSS vars or oklch reliably.
import type { OgTheme } from "./solar";

export interface OgPalette {
  bg: string;
  bgAccent: string; // subtle radial/hero tint
  fg: string; // primary text
  fgMuted: string; // secondary text
  lagoon: string;
  lagoonDeep: string;
  palm: string;
  line: string; // hairline / card border
  card: string; // island-shell surface
  up: string; // positive stat
  down: string; // negative stat
}

const LIGHT: OgPalette = {
  bg: "#e7f3ec",
  bgAccent: "rgba(79,184,178,0.30)",
  fg: "#173a40",
  fgMuted: "#416166",
  lagoon: "#4fb8b2",
  lagoonDeep: "#328f97",
  palm: "#2f6a4a",
  line: "rgba(23,58,64,0.14)",
  card: "rgba(255,255,255,0.86)",
  up: "#2f6a4a",
  down: "#b3402f",
};

const DARK: OgPalette = {
  bg: "#0a1418",
  bgAccent: "rgba(96,215,207,0.18)",
  fg: "#d7ece8",
  fgMuted: "#afcdc8",
  lagoon: "#60d7cf",
  lagoonDeep: "#8de5db",
  palm: "#6ec89a",
  line: "rgba(141,229,219,0.20)",
  card: "rgba(16,30,34,0.82)",
  up: "#6ec89a",
  down: "#e0846f",
};

export function palette(theme: OgTheme): OgPalette {
  return theme === "dark" ? DARK : LIGHT;
}
