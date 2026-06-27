import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Reveal-once intersection hook. Returns a ref to attach and a flag that flips
 * true the first time the element scrolls into view and stays true (the
 * observer disconnects after firing). Drives count-from-zero animations that
 * should run when their section becomes visible, not on mount.
 *
 * Falls back to immediately revealed where IntersectionObserver is absent.
 */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  return [ref, inView];
}
