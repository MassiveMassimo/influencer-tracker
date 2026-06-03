import { useEffect, useState } from "react";

/**
 * True once the `number-flow-react` custom element is registered. Until then
 * callers should render a static formatted string so SSR and the first client
 * paint match and the unupgraded element never flashes.
 */
export function useNumberFlowReady(): boolean {
  const [ready, setReady] = useState(
    () =>
      typeof customElements !== "undefined" &&
      Boolean(customElements.get("number-flow-react"))
  );

  useEffect(() => {
    if (ready) {
      return;
    }
    let cancelled = false;
    customElements.whenDefined("number-flow-react").then(() => {
      if (!cancelled) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  return ready;
}
