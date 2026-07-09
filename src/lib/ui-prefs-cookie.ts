import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import type { BadgeStyle } from "./preferences.tsx";

// Preferences the server must know at SSR time to get the first paint right — the badge
// variant (enamel vs candy swaps whole React SVG subtrees) and whether halal UI shows.
// These ride cookies, not localStorage, so the root loader can read them and seed
// PreferencesProvider — no flash, no hydration mismatch. Prefs that only drive CSS (theme,
// reduce-motion) stay on the pre-paint script instead. See preferences.tsx.
export interface SsrPrefs {
  badgeStyle: BadgeStyle;
  showHalalStatus: boolean;
}

// Server-only via createServerFn (the getCookie import is stripped from the client bundle).
export const getSsrPrefs = createServerFn({ method: "GET" }).handler(
  (): SsrPrefs => ({
    badgeStyle: getCookie("badge-style") === "candy" ? "candy" : "enamel",
    showHalalStatus: getCookie("show-halal") === "true",
  }),
);
