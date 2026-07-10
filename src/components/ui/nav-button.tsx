"use client";

// Button sibling of NavItem for NavMenu strips that drive in-page state instead of
// routing (e.g. pagination). Registers with the enclosing NavMenu so the animated
// hover/active pill tracks it; active text goes foreground + semibold like a tab.
import { forwardRef, useEffect, useMemo, useRef, type ButtonHTMLAttributes } from "react";
import { useNavMenu } from "#/components/ui/nav-menu.tsx";
import { cn, mergeRefs } from "#/lib/utils.ts";

interface NavButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  index: number;
  slug: string;
}

export const NavButton = forwardRef<HTMLButtonElement, NavButtonProps>(
  ({ index, slug, className, children, ...rest }, ref) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const { registerItem, registerSlug, activeSlug } = useNavMenu();
    useEffect(() => {
      registerItem(index, internalRef.current);
      registerSlug(index, slug);
      return () => {
        registerItem(index, null);
        registerSlug(index, null);
      };
    }, [index, slug, registerItem, registerSlug]);
    const isActiveRoute = activeSlug === slug;
    const setRef = useMemo(() => mergeRefs(internalRef, ref), [ref]);
    return (
      <button
        type="button"
        ref={setRef}
        data-nav-index={index}
        aria-current={isActiveRoute ? "page" : undefined}
        className={cn(
          "relative z-10 flex cursor-pointer items-center justify-center text-[13px] transition-colors outline-none",
          isActiveRoute
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
NavButton.displayName = "NavButton";
