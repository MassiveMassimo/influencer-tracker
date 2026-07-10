import type { ReactNode } from "react";
import { NavMenu } from "./ui/nav-menu";
import { NavItem } from "./ui/nav-item";

// Shared scaffold behind the rail's two searchable lists (RailStocks, and the
// creators list in WorkspaceRail's RailContent): a NavMenu-driven listbox where
// only the row body differs. Owns the NavMenu + ul/li/NavItem wiring, the
// keyboard-active/aria-selected bookkeeping, and the single-message empty state
// (the "list is entirely empty" vs "search matched nothing" distinction is the
// caller's call — it already knows which applies and passes the right `emptyText`).
export function RailNavList<T>({
  items,
  getKey,
  section,
  navAriaLabel,
  listAriaLabel,
  activeSlug,
  searchOpen,
  activeIndex,
  setActiveIndex,
  getSlug,
  // `to`/`params` are normally literal-inferred by TanStack Router's typed
  // `createLink`; threading them through a generic render prop loses that
  // inference, so the cast at the NavItem spread below is the escape hatch.
  getLinkProps,
  getItemClassName,
  onRowClick,
  renderRow,
  emptyText,
}: {
  items: T[];
  getKey: (item: T) => string;
  // Drives the `{section}-opt-{i}` option id (must match the search input's
  // `aria-controls`/`aria-activedescendant` in RailSectionTrigger).
  section: string;
  navAriaLabel: string;
  listAriaLabel: string;
  activeSlug: string | null;
  searchOpen: boolean;
  activeIndex: number;
  setActiveIndex?: (i: number) => void;
  getSlug: (item: T) => string;
  getLinkProps: (item: T) => { to: string; params?: Record<string, string> };
  getItemClassName?: (item: T, isActiveRoute: boolean) => string;
  onRowClick?: () => void;
  renderRow: (item: T, index: number) => ReactNode;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-muted-foreground/60">{emptyText}</div>;
  }

  return (
    <NavMenu
      activeSlug={activeSlug}
      // While searching, the combobox activeIndex drives the hover pill.
      controlledActiveIndex={searchOpen ? activeIndex : undefined}
      radius="rounded-md"
      aria-label={navAriaLabel}
    >
      <ul
        id={`rail-${section}-results`}
        role="listbox"
        aria-label={listAriaLabel}
        className="flex flex-col gap-0.5"
      >
        {items.map((item, i) => {
          const slug = getSlug(item);
          const keyboardActive = activeIndex === i;
          const isActiveRoute = activeSlug === slug;
          return (
            <li
              key={getKey(item)}
              id={`${section}-opt-${i}`}
              role="option"
              aria-selected={keyboardActive}
              onMouseEnter={() => searchOpen && setActiveIndex?.(i)}
            >
              <NavItem
                index={i}
                slug={slug}
                {...(getLinkProps(item) as any)}
                onClick={onRowClick}
                tabIndex={searchOpen ? -1 : undefined}
                className={getItemClassName?.(item, isActiveRoute)}
              >
                {renderRow(item, i)}
              </NavItem>
            </li>
          );
        })}
      </ul>
    </NavMenu>
  );
}
