import { useSyncExternalStore } from "react";

/**
 * True once the `number-flow-react` custom element is registered. Until then
 * callers should render a static formatted string so SSR and the first client
 * paint match and the unupgraded element never flashes.
 *
 * Uses useSyncExternalStore so the server snapshot (false) is ALSO used for the
 * first client (hydration) render — even though @number-flow/react registers the
 * element at import time, so a `useState` initializer reading customElements.get()
 * would return true on the client and mismatch the server's static fallback
 * (React hydration error #418). After hydration React reads the client snapshot
 * and upgrades; the subscribe re-renders if registration lands later.
 */
export function useNumberFlowReady(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof customElements === "undefined") return () => {};
      let cancelled = false;
      customElements.whenDefined("number-flow-react").then(() => {
        if (!cancelled) onChange();
      });
      return () => {
        cancelled = true;
      };
    },
    () => Boolean(customElements.get("number-flow-react")),
    () => false,
  );
}
