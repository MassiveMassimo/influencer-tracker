import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Ref, RefCallback, RefObject } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Assigns a node to every ref in `refs` (function or object refs), so a single
// DOM node can be tracked by an internal ref and forwarded to an external one.
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as RefObject<T | null>).current = node;
      }
    }
  };
}
