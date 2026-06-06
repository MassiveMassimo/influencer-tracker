import * as React from "react";

export type ThemeMode = "light" | "dark" | "auto";

export interface Preferences {
  theme: ThemeMode;
  reduceMotion: boolean;
  reduceHaptics: boolean;
}

const DEFAULTS: Preferences = {
  theme: "auto",
  reduceMotion: false,
  reduceHaptics: false,
};

export function readStoredPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  const t = window.localStorage.getItem("theme");
  return {
    theme: t === "light" || t === "dark" || t === "auto" ? t : "auto",
    reduceMotion: window.localStorage.getItem("reduce-motion") === "true",
    reduceHaptics: window.localStorage.getItem("reduce-haptics") === "true",
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
}

const PreferencesContext = React.createContext<PreferencesContextValue | null>(
  null
);

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = React.useState<Preferences>(DEFAULTS);

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

  const value = React.useMemo<PreferencesContextValue>(
    () => ({ ...prefs, setTheme, setReduceMotion, setReduceHaptics }),
    [prefs, setTheme, setReduceMotion, setReduceHaptics]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = React.useContext(PreferencesContext);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
