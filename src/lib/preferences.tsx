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

// badgeStyle + showHalalStatus ride cookies (not localStorage) so the server can read them
// during SSR and get the first paint right — badgeStyle swaps React SVG subtrees and
// showHalalStatus gates whole halal panels, neither of which a pre-paint CSS script can
// fix. Read/written here; the server side is getSsrPrefs (ui-prefs-cookie.ts).
function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
}

function writeCookie(name: string, value: string) {
  // One year; Lax suffices (same-site read during SSR navigation).
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function readStoredPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  const t = window.localStorage.getItem("theme");
  return {
    theme: t === "light" || t === "dark" || t === "auto" ? t : "auto",
    reduceMotion: window.localStorage.getItem("reduce-motion") === "true",
    reduceHaptics: window.localStorage.getItem("reduce-haptics") === "true",
    showHalalStatus: readCookie("show-halal") === "true",
    badgeStyle: readCookie("badge-style") === "candy" ? "candy" : "enamel",
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

interface PreferencesContextValue extends Preferences {
  setTheme: (t: ThemeMode) => void;
  setReduceMotion: (v: boolean) => void;
  setReduceHaptics: (v: boolean) => void;
  setShowHalalStatus: (v: boolean) => void;
  setBadgeStyle: (v: BadgeStyle) => void;
}

const PreferencesContext = React.createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  // Seeded from cookies by the root loader so SSR + first client render agree — no flash,
  // no hydration mismatch — for the prefs the server must know (badge variant, halal UI).
  initial?: { badgeStyle?: BadgeStyle; showHalalStatus?: boolean };
}) {
  const [prefs, setPrefs] = React.useState<Preferences>(() => ({
    ...DEFAULTS,
    badgeStyle: initial?.badgeStyle ?? DEFAULTS.badgeStyle,
    showHalalStatus: initial?.showHalalStatus ?? DEFAULTS.showHalalStatus,
  }));

  // Hydrate + apply on mount (SSR-safe: no window access during render).
  React.useEffect(() => {
    const stored = readStoredPrefs();
    setPrefs(stored);
    applyTheme(stored.theme);
    applyReduceMotion(stored.reduceMotion);
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
    writeCookie("show-halal", String(showHalalStatus));
  }, []);

  const setBadgeStyle = React.useCallback((badgeStyle: BadgeStyle) => {
    setPrefs((p) => ({ ...p, badgeStyle }));
    writeCookie("badge-style", badgeStyle);
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
