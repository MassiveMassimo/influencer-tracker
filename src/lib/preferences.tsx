import * as React from "react";

export type ThemeMode = "light" | "dark" | "auto";
export type BadgeStyle = "enamel" | "candy";

export interface Preferences {
  theme: ThemeMode;
  reduceMotion: boolean;
  reduceHaptics: boolean;
  showHalalStatus: boolean;
  badgeStyle: BadgeStyle;
}

const DEFAULTS: Preferences = {
  theme: "auto",
  reduceMotion: false,
  reduceHaptics: false,
  showHalalStatus: false,
  badgeStyle: "enamel",
};

// True while the theme view-transition is animating. A click during that window
// can bounce focus to <body>, and Base UI's dialog closes on focus-out — so the
// Preferences dialog uses this to veto the spurious close. See ThemePicker.
let themeTransitioning = false;
export const isThemeTransitioning = () => themeTransitioning;
export const setThemeTransitioning = (v: boolean) => {
  themeTransitioning = v;
};

export function readStoredPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  const t = window.localStorage.getItem("theme");
  return {
    theme: t === "light" || t === "dark" || t === "auto" ? t : "auto",
    reduceMotion: window.localStorage.getItem("reduce-motion") === "true",
    reduceHaptics: window.localStorage.getItem("reduce-haptics") === "true",
    showHalalStatus: window.localStorage.getItem("show-halal") === "true",
    badgeStyle: window.localStorage.getItem("badge-style") === "candy" ? "candy" : "enamel",
  };
}

// Lifted from the old ThemeToggle: resolve `auto` against the OS, set the class
// + data-theme + color-scheme on <html>.
export function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
  if (mode === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
  document.documentElement.style.colorScheme = resolved;
}

function applyReduceMotion(on: boolean) {
  if (on) document.documentElement.setAttribute("data-reduce-motion", "true");
  else document.documentElement.removeAttribute("data-reduce-motion");
}

// BadgeShape renders both variants; this <html> attr is what CSS reads to show one
// (see trait-badges.tsx + styles.css). The pre-paint script sets it before first paint;
// this keeps it in sync when the user toggles live.
function applyBadgeStyle(style: BadgeStyle) {
  document.documentElement.setAttribute("data-badge-style", style);
}

interface PreferencesContextValue extends Preferences {
  setTheme: (t: ThemeMode) => void;
  setReduceMotion: (v: boolean) => void;
  setReduceHaptics: (v: boolean) => void;
  setShowHalalStatus: (v: boolean) => void;
  setBadgeStyle: (v: BadgeStyle) => void;
}

const PreferencesContext = React.createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = React.useState<Preferences>(DEFAULTS);

  // Hydrate + apply on mount (SSR-safe: no window access during render, so SSR and the
  // first client render both start from DEFAULTS — no hydration mismatch). The pre-paint
  // script already set the CSS-driven attrs (theme, reduce-motion, badge-style) before
  // paint; this re-applies them from the source of truth and syncs React state.
  React.useEffect(() => {
    const stored = readStoredPrefs();
    setPrefs(stored);
    applyTheme(stored.theme);
    applyReduceMotion(stored.reduceMotion);
    applyBadgeStyle(stored.badgeStyle);
  }, []);

  // Follow system changes while in auto.
  React.useEffect(() => {
    if (prefs.theme !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [prefs.theme]);

  const setTheme = React.useCallback((theme: ThemeMode) => {
    setPrefs((p) => ({ ...p, theme }));
    applyTheme(theme);
    window.localStorage.setItem("theme", theme);
  }, []);

  const setReduceMotion = React.useCallback((reduceMotion: boolean) => {
    setPrefs((p) => ({ ...p, reduceMotion }));
    applyReduceMotion(reduceMotion);
    window.localStorage.setItem("reduce-motion", String(reduceMotion));
  }, []);

  const setReduceHaptics = React.useCallback((reduceHaptics: boolean) => {
    setPrefs((p) => ({ ...p, reduceHaptics }));
    window.localStorage.setItem("reduce-haptics", String(reduceHaptics));
  }, []);

  const setShowHalalStatus = React.useCallback((showHalalStatus: boolean) => {
    setPrefs((p) => ({ ...p, showHalalStatus }));
    window.localStorage.setItem("show-halal", String(showHalalStatus));
  }, []);

  const setBadgeStyle = React.useCallback((badgeStyle: BadgeStyle) => {
    setPrefs((p) => ({ ...p, badgeStyle }));
    applyBadgeStyle(badgeStyle);
    window.localStorage.setItem("badge-style", badgeStyle);
  }, []);

  const value = React.useMemo<PreferencesContextValue>(
    () => ({
      ...prefs,
      setTheme,
      setReduceMotion,
      setReduceHaptics,
      setShowHalalStatus,
      setBadgeStyle,
    }),
    [prefs, setTheme, setReduceMotion, setReduceHaptics, setShowHalalStatus, setBadgeStyle],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = React.useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
