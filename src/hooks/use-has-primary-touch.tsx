import { useEffect, useState } from "react";

function detectTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return hasTouch && window.matchMedia("(pointer: coarse)").matches;
}

function useTouchPrimaryImpl(lazyInitial: () => boolean) {
  const [isTouchPrimary, setIsTouchPrimary] = useState(lazyInitial);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const controller = new AbortController();
    const { signal } = controller;
    const handleTouch = () => setIsTouchPrimary(detectTouchPrimary());

    const mq = window.matchMedia("(pointer: coarse)");
    mq.addEventListener("change", handleTouch, { signal });
    window.addEventListener("pointerdown", handleTouch, { signal });

    handleTouch();

    return () => controller.abort();
  }, []);

  return isTouchPrimary;
}

// SSR-safe: false until mounted, then tracks the query. Use in components that
// render during SSR so the first client render matches the server (no hydration
// mismatch); the effect resolves the real value right after paint.
export function useTouchPrimary() {
  return useTouchPrimaryImpl(() => false);
}

// Eager: resolves synchronously on the FIRST client render. Use ONLY in
// client-only (non-SSR) components — e.g. the React.lazy chart chunk — where the
// first render must already know the pointer type, otherwise an enter animation
// fires for one frame before the SSR-safe value flips. Never use in an
// SSR-rendered tree (would mismatch the server's false).
export function useTouchPrimaryEager() {
  return useTouchPrimaryImpl(detectTouchPrimary);
}
