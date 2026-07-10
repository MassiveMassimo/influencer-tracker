"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  Children,
  cloneElement,
  isValidElement,
  type ComponentPropsWithoutRef,
} from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { LucideIcon as IconComponent } from "lucide-react";
import { cn, mergeRefs } from "#/lib/utils.ts";
import { shape } from "#/lib/shape.ts";
import { IndicatorOverlays, useIndicatorTrack } from "#/components/ui/indicator-track.tsx";
import { WeightSwapLabel } from "#/components/ui/weight-swap-label.tsx";

// TimeframeTabs renders during SSR; useLayoutEffect warns on the server, so fall
// back to useEffect there (the layout read only matters post-hydration anyway).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ─────────────────────── Contexts ─────────────────────── */

interface TabsValueOrderContextValue {
  valueOrder: string[];
  setValueOrder: (order: string[]) => void;
  selectedValue: string | undefined;
}

const TabsValueOrderContext = createContext<TabsValueOrderContextValue | null>(null);

interface TabsListContextValue {
  registerTab: (index: number, value: string, el: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedValue: string | undefined;
  setOptimisticIdx: (index: number) => void;
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const ctx = useContext(TabsListContext);
  if (!ctx) throw new Error("TabItem must be used within a TabsList");
  return ctx;
}

/* ─────────────────────── Tabs (Root) ─────────────────────── */

interface TabsProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
  "onValueChange" | "value" | "defaultValue" | "onSelect"
> {
  value?: string;
  onValueChange?: (value: string) => void;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  defaultValue?: string;
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ value, onValueChange, selectedIndex, onSelect, defaultValue, children, ...props }, ref) => {
    const [valueOrder, setValueOrder] = useState<string[]>([]);
    const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(defaultValue);
    const updateValueOrder = useCallback((order: string[]) => {
      setValueOrder((current) => {
        if (current.length === order.length && current.every((v, i) => v === order[i])) {
          return current;
        }
        return order;
      });
    }, []);

    // Resolve value: explicit value > selectedIndex lookup > uncontrolled state.
    // Uncontrolled with no defaultValue falls back to the first tab so the
    // FF layer's selectedValue matches what the primitive shows.
    const resolvedValue =
      value ??
      (selectedIndex != null ? valueOrder[selectedIndex] : (uncontrolledValue ?? valueOrder[0]));

    // Base UI passes (value, eventDetails); we only need value.
    const handleValueChange = useCallback(
      (newValue: unknown) => {
        const v = newValue as string;
        if (value === undefined && selectedIndex == null) {
          setUncontrolledValue(v);
        }
        onValueChange?.(v);
        if (onSelect) {
          const idx = valueOrder.indexOf(v);
          if (idx !== -1) onSelect(idx);
        }
      },
      [onValueChange, onSelect, valueOrder, value, selectedIndex],
    );

    return (
      <TabsValueOrderContext.Provider
        value={{
          valueOrder,
          setValueOrder: updateValueOrder,
          selectedValue: resolvedValue,
        }}
      >
        {/*
          Always controlled: Base UI's useControlled logs a dev warning when
          value flips undefined → defined. valueOrder is empty on the first
          commit, so fall back to an empty-string sentinel — TabsList's
          layout effect populates valueOrder pre-paint, so the corrected
          value lands before anything is visible.
        */}
        <TabsPrimitive.Root
          ref={ref}
          value={resolvedValue ?? ""}
          onValueChange={handleValueChange}
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsValueOrderContext.Provider>
    );
  },
);

Tabs.displayName = "Tabs";

/* ─────────────────────── TabsList ─────────────────────── */

type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ children, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const setContainerRef = useMemo(() => mergeRefs(containerRef, ref), [ref]);
    const valueOrderCtx = useContext(TabsValueOrderContext);
    const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null);

    const values = useMemo(
      () =>
        Children.toArray(children)
          .filter(isValidElement)
          .map((child) => (child.props as { value?: string }).value)
          .filter((v): v is string => typeof v === "string"),
      [children],
    );
    const valueOrderKey = values.join(",");
    const setValueOrder = valueOrderCtx?.setValueOrder;

    useIsoLayoutEffect(() => {
      setValueOrder?.(values);
    }, [setValueOrder, valueOrderKey]);

    // Base UI Tabs owns arrow/Home/End keyboard nav, so the track only wires
    // pointer + focus; blur keeps the hover pill while the pointer stays in.
    const track = useIndicatorTrack(containerRef, {
      axis: "x",
      indexAttr: "data-proximity-index",
      keepHoverOnBlurWhileMouseInside: true,
    });
    const { registerItem, measureItems, hoverIndex: hoveredIndex } = track;

    const registerTab = useCallback(
      (index: number, _value: string, el: HTMLElement | null) => {
        registerItem(index, el);
      },
      [registerItem],
    );

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const selectedValue = valueOrderCtx?.selectedValue;
    const selectedIdx = selectedValue !== undefined ? values.indexOf(selectedValue) : -1;

    useEffect(() => {
      setOptimisticIdx(selectedIdx >= 0 ? selectedIdx : null);
    }, [selectedIdx]);

    const indexedChildren = useMemo(
      () =>
        Children.map(children, (child, i) => {
          // Skip plain DOM elements — injecting _index into e.g. a <div>
          // triggers React's unknown-prop warning.
          if (isValidElement(child) && typeof child.type !== "string") {
            return cloneElement(child, { _index: i } as Record<string, unknown>);
          }
          return child;
        }),
      [children],
    );

    return (
      <TabsListContext.Provider
        value={{
          registerTab,
          hoveredIndex,
          selectedValue,
          setOptimisticIdx,
        }}
      >
        <TabsPrimitive.List
          // Match Radix's `activationMode="automatic"` — arrow keys move + activate.
          activateOnFocus
          ref={setContainerRef}
          {...track.handlers}
          className={cn(
            "relative inline-flex items-center gap-0.5 bg-muted p-1 select-none",
            shape.container,
            className,
          )}
          {...props}
        >
          <IndicatorOverlays track={track} selectedIndex={optimisticIdx} mode="tabs" raised />

          {indexedChildren}
        </TabsPrimitive.List>
      </TabsListContext.Provider>
    );
  },
);

TabsList.displayName = "TabsList";

/* ─────────────────────── TabItem ─────────────────────── */

interface TabItemProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Tab> {
  value: string;
  icon?: IconComponent;
  label: string;
  /** @internal Auto-assigned by TabsList. */
  _index?: number;
}

const TabItem = forwardRef<HTMLButtonElement, TabItemProps>(
  ({ value, icon: Icon, label, _index = 0, className, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const setRef = useMemo(() => mergeRefs(internalRef, ref), [ref]);
    const { registerTab, hoveredIndex, selectedValue, setOptimisticIdx } = useTabsList();

    useEffect(() => {
      registerTab(_index, value, internalRef.current);
      return () => registerTab(_index, value, null);
    }, [_index, value, registerTab]);

    const isSelected = selectedValue === value;
    const isActive = hoveredIndex === _index || isSelected;

    return (
      <TabsPrimitive.Tab
        onClick={() => setOptimisticIdx(_index)}
        ref={setRef}
        value={value}
        data-proximity-index={_index}
        className={cn(
          // Fixed height (not py) so the text-box trim below doesn't shrink
          // the tab — browsers without text-box support render identically.
          "relative z-10 flex h-8 cursor-pointer items-center gap-2 border-none bg-transparent px-3 outline-none",
          className,
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={16}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              "transition-[color,stroke-width] duration-80",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          />
        )}
        <WeightSwapLabel
          label={label}
          colorActive={isActive}
          weightActive={isSelected}
          className="whitespace-nowrap"
          durationClassName="duration-80"
        />
      </TabsPrimitive.Tab>
    );
  },
);

TabItem.displayName = "TabItem";

/* ─────────────────────── TabPanel ─────────────────────── */

interface TabPanelProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Panel> {
  value: string;
}

const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(({ className, ...props }, ref) => {
  return <TabsPrimitive.Panel ref={ref} className={cn("outline-none", className)} {...props} />;
});

TabPanel.displayName = "TabPanel";

export { Tabs, TabsList, TabItem, TabPanel };
export type { TabsProps, TabsListProps, TabItemProps, TabPanelProps };
