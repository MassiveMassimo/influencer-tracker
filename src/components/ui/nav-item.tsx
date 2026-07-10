"use client";

// FF `nav-item`, adapted to our stack: a TanStack typed link (via createLink) that
// registers itself with the enclosing NavMenu for the proximity pill. Two content
// modes: `label` (+ optional `icon`/`leading`) mirrors FF's semibold-on-active
// treatment; `children` renders an arbitrary row (avatars, sparklines) where the
// pill alone conveys state. Pairs with `NavMenu`.
import { forwardRef, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { rowSeparatorClass, useNavMenu } from "#/components/ui/nav-menu.tsx";
import { cn, mergeRefs } from "#/lib/utils.ts";
import { shape } from "#/lib/shape.ts";
import { WeightSwapLabel } from "#/components/ui/weight-swap-label.tsx";
import type { AnimatedIcon, AnimatedIconHandle } from "#/components/icons/types.ts";

interface NavItemBaseProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  index: number;
  slug: string;
  label?: string;
  icon?: LucideIcon;
  // A copy-in lucide-animated icon, animated on row hover (not just icon hover).
  // Mutually exclusive with `icon`.
  animatedIcon?: AnimatedIcon;
  children?: ReactNode;
}

const NavItemBase = forwardRef<HTMLAnchorElement, NavItemBaseProps>(
  (
    { index, slug, label, icon: Icon, animatedIcon: AnimatedIcon, children, className, ...rest },
    ref,
  ) => {
    const internalRef = useRef<HTMLAnchorElement>(null);
    const animatedIconRef = useRef<AnimatedIconHandle>(null);
    const { registerItem, registerSlug, activeIndex, activeSlug, separated } = useNavMenu();
    useEffect(() => {
      registerItem(index, internalRef.current);
      registerSlug(index, slug);
      return () => {
        registerItem(index, null);
        registerSlug(index, null);
      };
    }, [index, slug, registerItem, registerSlug]);
    const isActive = activeIndex === index;
    const isActiveRoute = activeSlug === slug;
    const activeText = isActiveRoute || isActive;
    const setRef = useMemo(() => mergeRefs(internalRef, ref), [ref]);
    return (
      <a
        ref={setRef}
        data-nav-index={index}
        aria-current={isActiveRoute ? "page" : undefined}
        className={cn(
          "relative z-10 flex items-center no-underline outline-none",
          // Separated (table) rows are square: a border-b on a rounded row curves
          // up at both ends. Non-separated rows keep the pill radius.
          separated ? "rounded-none" : shape.item,
          // Label rows are fixed height like FF; custom children size to content.
          children ? "w-full" : "h-8 px-3",
          rowSeparatorClass(separated, index, activeIndex),
          className,
        )}
        {...rest}
        {...(AnimatedIcon && {
          onMouseEnter: () => animatedIconRef.current?.startAnimation(),
          onMouseLeave: () => animatedIconRef.current?.stopAnimation(),
        })}
      >
        {children ?? (
          <>
            {Icon && (
              <Icon
                size={16}
                strokeWidth={activeText ? 2 : 1.5}
                className={cn(
                  "mr-2 shrink-0 transition-[color,stroke-width] duration-[80ms]",
                  activeText ? "text-foreground" : "text-muted-foreground",
                )}
              />
            )}
            {AnimatedIcon && (
              <AnimatedIcon
                ref={animatedIconRef}
                size={16}
                className={cn(
                  "mr-2 flex shrink-0 transition-colors duration-[80ms]",
                  activeText ? "text-foreground" : "text-muted-foreground",
                )}
              />
            )}
            <WeightSwapLabel
              label={label}
              colorActive={activeText}
              weightActive={isActiveRoute}
              className="flex-1"
              durationClassName="duration-[80ms]"
            />
          </>
        )}
      </a>
    );
  },
);
NavItemBase.displayName = "NavItemBase";

const CreatedNavItem = createLink(NavItemBase);

export const NavItem: LinkComponent<typeof NavItemBase> = (props) => (
  <CreatedNavItem preload="intent" {...props} />
);
