"use client";

// Div sibling of NavItem/NavButton for NavMenu rows that open a dialog (e.g. the
// proof viewer) instead of routing. These rows contain inner <Link>s, so the row
// itself can't be an <a> or <button> (nested interactives) — it's a
// role="button" div with keyboard activation. Registers with the enclosing
// NavMenu so the animated hover/active pill tracks it, exactly like NavItem.
import { forwardRef, useEffect, useMemo, useRef, type HTMLAttributes } from "react";
import { rowSeparatorClass, useNavMenu } from "#/components/ui/nav-menu.tsx";
import { cn, mergeRefs } from "#/lib/utils.ts";

interface NavRowProps extends HTMLAttributes<HTMLDivElement> {
  index: number;
  slug: string;
  onActivate: () => void;
}

export const NavRow = forwardRef<HTMLDivElement, NavRowProps>(
  ({ index, slug, onActivate, className, children, ...rest }, ref) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const { registerItem, registerSlug, activeIndex, separated } = useNavMenu();
    useEffect(() => {
      registerItem(index, internalRef.current);
      registerSlug(index, slug);
      return () => {
        registerItem(index, null);
        registerSlug(index, null);
      };
    }, [index, slug, registerItem, registerSlug]);
    const setRef = useMemo(() => mergeRefs(internalRef, ref), [ref]);
    return (
      <div
        ref={setRef}
        role="button"
        tabIndex={0}
        data-nav-index={index}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate();
          }
        }}
        className={cn(
          "relative z-10 cursor-pointer outline-none",
          rowSeparatorClass(separated, index, activeIndex),
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
NavRow.displayName = "NavRow";
