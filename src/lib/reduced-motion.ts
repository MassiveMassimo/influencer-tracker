// True when motion should be skipped — OS `prefers-reduced-motion` OR the app's
// own Preferences toggle (`data-reduce-motion` on <html>, set pre-paint in
// __root's THEME_INIT_SCRIPT and by preferences.tsx). Client-only; false on SSR.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.getAttribute("data-reduce-motion") === "true"
  );
}
