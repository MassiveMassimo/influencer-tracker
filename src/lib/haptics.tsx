import * as React from "react";
import { WebHaptics } from "web-haptics";
import { usePreferences } from "./preferences.tsx";

export function shouldFire({
  supported,
  reduceHaptics,
}: {
  supported: boolean;
  reduceHaptics: boolean;
}): boolean {
  return supported && !reduceHaptics;
}

export interface Haptics {
  tick: () => void;
  select: () => void;
  impact: () => void;
}

const HapticsContext = React.createContext<Haptics | null>(null);

export function HapticsProvider({ children }: { children: React.ReactNode }) {
  const { reduceHaptics } = usePreferences();
  const instanceRef = React.useRef<WebHaptics | null>(null);

  React.useEffect(() => {
    if (!WebHaptics.isSupported) return;
    instanceRef.current = new WebHaptics();
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  const value = React.useMemo<Haptics>(() => {
    const fire = (input: Parameters<WebHaptics["trigger"]>[0]) => {
      if (!shouldFire({ supported: WebHaptics.isSupported, reduceHaptics })) return;
      void instanceRef.current?.trigger(input);
    };
    return {
      tick: () => fire(10),
      select: () => fire("nudge"),
      impact: () => fire(25),
    };
  }, [reduceHaptics]);

  return <HapticsContext.Provider value={value}>{children}</HapticsContext.Provider>;
}

// Safe no-op default if used outside the provider (e.g. isolated tests).
const NOOP: Haptics = { tick: () => {}, select: () => {}, impact: () => {} };

export function useHaptics(): Haptics {
  return React.useContext(HapticsContext) ?? NOOP;
}
