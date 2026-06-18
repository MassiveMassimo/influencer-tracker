# Web Haptics + Preferences (on Base UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tasteful web haptics (chart-scrub ticks + a few curated touch points) and a sidebar Preferences modal (theme preview-cards + reduce-motion + reduce-haptics), after migrating the UI primitive layer from radix to Base UI.

**Architecture:** Phase 0 swaps radix primitives → Base UI (`@base-ui/react`) so new components are built natively on it (coss-ui — the design source — is built on Base UI). vaul drawer stays (no Base UI equivalent). Phase 1 adds a `PreferencesProvider` (single owner of theme + the two reduce flags, persisted to localStorage) and a `HapticsProvider` wrapping one `web-haptics` instance, then wires gated haptic calls into the chart-interaction hook and a few touch points.

**Tech Stack:** TanStack Start, React 19, `@base-ui/react@^1.5.0`, `vaul`, `web-haptics`, Tailwind v4, `bun test`, `#/` → `src/`.

**Conventions:** Tests run on `bun test`; typecheck `bunx tsc --noEmit`. Commit after each task. Base UI differs from radix: no `Slot`/`asChild` (use the `render` prop / `useRender`), transitions use `data-starting-style`/`data-ending-style` + `transition-*` (not `data-[state=open]:animate-in`), open/close expose `data-open`/`data-closed`.

---

## File Map

**Phase 0 — migration (modify):**
- `src/components/ui/separator.tsx` — radix Separator → Base UI Separator
- `src/components/ui/badge.tsx` — drop radix `Slot`/`asChild`
- `src/components/ui/accordion.tsx` — radix Accordion → Base UI Accordion
- `src/components/ui/scroll-area.tsx` — radix scroll primitive → Base UI ScrollArea (mask logic unchanged)
- `src/components/proof-viewer.tsx` — radix Dialog → Base UI Dialog
- `package.json` — add `@base-ui/react`, remove `radix-ui` + `@radix-ui/react-scroll-area`
- `CLAUDE.md` — invert "Component provenance" note (primitives are now Base UI)

**Phase 1 — feature (create unless noted):**
- `src/lib/preferences.tsx` — `PreferencesProvider` + `usePreferences()`
- `src/lib/preferences.test.ts` — persistence/apply tests
- `src/styles.css` (modify) — broad `[data-reduce-motion]` override
- `src/lib/haptics.tsx` — `HapticsProvider` + `useHaptics()`
- `src/lib/haptics.test.ts` — gating no-op tests
- `src/components/ui/switch.tsx` — Base UI Switch
- `src/components/ui/toggle-group.tsx` — Base UI ToggleGroup/Toggle
- `src/components/ThemePicker.tsx` — preview-card theme switcher
- `src/components/Preferences.tsx` — modal (Dialog desktop / vaul drawer mobile)
- `src/components/WorkspaceRail.tsx` (modify) — gear trigger replaces ThemeToggle
- `src/components/ThemeToggle.tsx` — delete
- `src/router.tsx` or `src/routes/__root.tsx` (modify) — mount providers
- `src/components/charts/use-chart-interaction.ts` (modify) — scrub ticks
- ticker route + call-row + proof-viewer (modify) — tab/drawer/row haptics

---

# Phase 0 — radix → Base UI migration

### Task 0: Install Base UI

**Files:** `package.json`

- [ ] **Step 1: Install**

Run: `bun add @base-ui/react`
Expected: `@base-ui/react` (^1.5.0) added to dependencies.

- [ ] **Step 2: Verify it resolves**

Run: `bunx tsc --noEmit`
Expected: no new errors from the install (existing code untouched).

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @base-ui/react"
```

---

### Task 1: Migrate Separator

**Files:** Modify `src/components/ui/separator.tsx`

Base UI `Separator` has `orientation` + `render` (no `decorative`), and emits `data-orientation` (radix used `data-horizontal`/`data-vertical`).

- [ ] **Step 1: Replace the file**

```tsx
import * as React from "react"
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "#/lib/utils.ts"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
```

- [ ] **Step 2: Find call sites still passing `decorative`**

Run: `grep -rn "decorative" src/`
Expected: no results (it was only defaulted internally). If any call passes `decorative`, remove that prop there.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors referencing separator.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/separator.tsx
git commit -m "refactor(ui): migrate separator to Base UI"
```

---

### Task 2: Migrate Badge (drop Slot/asChild)

**Files:** Modify `src/components/ui/badge.tsx`

- [ ] **Step 1: Check whether `asChild` is actually used on Badge**

Run: `grep -rn "Badge" src/ | grep -i "asChild"`
Expected output determines the path:
- **No results** → remove the `asChild` prop entirely (YAGNI). Use Step 2a.
- **Has results** → preserve composition via Base UI `useRender`. Use Step 2b.

- [ ] **Step 2a: (asChild unused) Replace just the Slot bits**

Change the import line — delete `import { Slot } from "radix-ui"`. Then change the component:

```tsx
function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}
```

- [ ] **Step 2b: (asChild used) Replace Slot with `useRender`**

```tsx
import { useRender } from "@base-ui/react/use-render"
// ...delete: import { Slot } from "radix-ui"

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { render?: useRender.RenderProp }) {
  const element = useRender({
    render: render ?? <span />,
    props: {
      "data-slot": "badge",
      "data-variant": variant,
      className: cn(badgeVariants({ variant }), className),
      ...props,
    },
  })
  return element
}
```
Then update each call site that used `asChild` to use `render={<a .../>}` (Base UI pattern) instead.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors referencing badge.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/badge.tsx
git commit -m "refactor(ui): drop radix Slot from badge"
```

---

### Task 3: Migrate Accordion

**Files:** Modify `src/components/ui/accordion.tsx`

Base UI parts: `Accordion.Root/Item/Header/Trigger/Panel`. Trigger open-state attr is `data-panel-open` (radix used `data-state=open`). Panel animates height via the `--accordion-panel-height` CSS var Base UI sets, with `data-starting-style`/`data-ending-style`.

- [ ] **Step 1: Replace the file**

```tsx
import * as React from "react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "#/lib/utils.ts"

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border/60 last:border-b-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left font-medium text-sm outline-none transition-all hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-panel-open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Panel>) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="h-[var(--accordion-panel-height)] overflow-hidden text-sm transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0"
      {...props}
    >
      <div className={cn("pt-0 pb-4 text-muted-foreground", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
```

- [ ] **Step 2: Check the Root usage on the landing Q&A**

Run: `grep -rn "Accordion" src/routes/ src/components/ | grep -iv "ui/accordion"`
Base UI `Accordion.Root` defaults to multiple-open and uses `value`/`defaultValue` as arrays. If a call uses radix's `type="single" collapsible`, change it: Base UI is multiple by default — pass no `type`; for single-open behavior wire `openMultiple={false}`. Update the call site accordingly.

- [ ] **Step 3: Remove now-dead `animate-accordion-*` keyframes if present**

Run: `grep -rn "accordion" src/styles.css tailwind.config* 2>/dev/null`
If `--radix-accordion-content-height` keyframes exist and are now unused, remove them (their job is replaced by the inline `transition-[height]`). If they're referenced elsewhere, leave them.

- [ ] **Step 4: Typecheck + manual verify**

Run: `bunx tsc --noEmit` (expect no accordion errors).
Manual: `bun dev`, open the landing page, expand/collapse the "How to read this" Q&A — opens/closes with a height transition, chevron rotates.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/accordion.tsx src/styles.css
git commit -m "refactor(ui): migrate accordion to Base UI"
```

---

### Task 4: Migrate ScrollArea (mask logic preserved)

**Files:** Modify `src/components/ui/scroll-area.tsx`

Only the **non-touch branch** uses the radix primitive; the touch branch + `ScrollMask` are primitive-agnostic and stay. Swap the non-touch `Root/Viewport/Scrollbar/Thumb/Corner` to Base UI `ScrollArea.*`, keeping `viewportRef` on the Viewport so the existing scroll/resize mask detection keeps working. Base UI Scrollbar/Thumb use `data-orientation` and visibility data attrs.

- [ ] **Step 1: Swap the import**

Replace line 5:
```tsx
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
```

- [ ] **Step 2: Update the non-touch branch JSX** (the `else` block, ~lines 109-131)

```tsx
        <ScrollAreaPrimitive.Root
          ref={ref}
          data-slot="scroll-area"
          className={cn("relative overflow-hidden", className)}
          style={{ ["--scroll-mask-color" as string]: maskColor, ...style }}
          {...props}
        >
          <ScrollAreaPrimitive.Viewport
            ref={viewportRef}
            data-slot="scroll-area-viewport"
            className={cn("size-full rounded-[inherit]", viewportClassName)}
          >
            {children}
          </ScrollAreaPrimitive.Viewport>

          {maskHeight > 0 && <ScrollMask showMask={showMask} className={maskClassName} maskHeight={maskHeight} />}
          <ScrollBar />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
```

- [ ] **Step 3: Update `ScrollBar` to Base UI parts**

```tsx
const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
  const isTouch = React.useContext(ScrollAreaContext);
  if (isTouch) return null;
  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      className={cn(
        "flex touch-none p-px transition-colors duration-150 select-none hover:bg-muted dark:hover:bg-muted/50",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent px-1 pr-1.25",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "bg-border relative flex-1 origin-center rounded-full transition-[scale]",
          orientation === "vertical" && "my-1 active:scale-y-95",
          orientation === "horizontal" && "active:scale-x-98"
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
});

ScrollBar.displayName = "ScrollBar";
```
Also update the `ScrollArea.displayName = ...` line (line 136) to `ScrollArea.displayName = "ScrollArea"` (Base UI parts have no `.displayName`).

- [ ] **Step 4: Update the forwardRef generic type** (lines 19-21)

```tsx
const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors in scroll-area or its consumers.

- [ ] **Step 6: Manual verify all 3 wired surfaces**

Run `bun dev`. Check, on a desktop (non-touch) viewport:
1. Ticker calls table scrolls horizontally; edge fade appears only when overflowing, blends into the surface (no wrong-color edge).
2. Proof drawer body (mobile width) scrolls; top/bottom fade correct.
3. `WorkspaceRail` nav scrolls when creators overflow; fade correct.
Then a touch viewport (DevTools device mode): native scrolling + fade still work.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/scroll-area.tsx
git commit -m "refactor(ui): port scroll-area to Base UI, keep edge-fade mask"
```

---

### Task 5: Migrate ProofViewer Dialog

**Files:** Modify `src/components/proof-viewer.tsx`

radix `Dialog.Overlay`→Base UI `Dialog.Backdrop`; `Dialog.Content`→`Dialog.Popup`; `Dialog.Title asChild`→`render`; `VisuallyHidden.Root` (not in Base UI)→`className="sr-only"`. Transitions: replace `data-[state=open]:animate-in …` with `transition` + `data-[starting-style]`/`data-[ending-style]`.

- [ ] **Step 1: Swap imports** (lines 1-2)

```tsx
import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
```

- [ ] **Step 2: Replace the desktop branch** (lines 94-126)

```tsx
  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background p-6 shadow-xl transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {call && (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <Dialog.Title render={<h2 className="flex items-baseline" />}>
                    <Heading call={call} />
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Proof media and context for the {call.ticker} call.
                </Dialog.Description>
                <ProofContent call={call} />
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
```

- [ ] **Step 3: Fix the mobile (vaul) branch's `VisuallyHidden`** (lines 140-144)

vaul drawer stays. Replace the `VisuallyHidden.Root` wrapper around `DrawerDescription` with `sr-only`:
```tsx
              <DrawerDescription className="sr-only">
                Proof media and context for the {call.ticker} call.
              </DrawerDescription>
```
(`DrawerTitle asChild` stays — that's vaul, not radix.)

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors in proof-viewer.

- [ ] **Step 5: Manual verify**

`bun dev`. Desktop: click a call row → centered dialog fades+zooms in, close button + Esc + backdrop click all close it. Mobile width: row → bottom drawer (drag-to-dismiss intact).

- [ ] **Step 6: Commit**

```bash
git add src/components/proof-viewer.tsx
git commit -m "refactor(proof-viewer): migrate Dialog to Base UI"
```

---

### Task 6: Remove radix deps + provenance docs

**Files:** `package.json`, `CLAUDE.md`

- [ ] **Step 1: Confirm no radix imports remain**

Run: `grep -rn "radix" src/`
Expected: **no results**. If any remain, migrate them before continuing.

- [ ] **Step 2: Remove the deps**

Run: `bun remove radix-ui @radix-ui/react-scroll-area`

- [ ] **Step 3: Update CLAUDE.md provenance**

In the "Component provenance" section, change the note that primitives are "shadcn/ui-style (radix-ui + vaul + cva) — **not** coss-ui (Base UI)". New text: primitives are now Base UI (`@base-ui/react`) + vaul + cva; coss-ui designs map directly since coss-ui is built on Base UI. Update the `ui/scroll-area.tsx` row (lina design, reimplemented on Base UI ScrollArea) and the `ui/*` row.

- [ ] **Step 4: Full typecheck + test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock CLAUDE.md
git commit -m "chore: drop radix deps, update provenance to Base UI"
```

---

# Phase 1 — Preferences + Haptics (on Base UI)

### Task 7: PreferencesProvider + reduce-motion CSS

**Files:** Create `src/lib/preferences.tsx`, `src/lib/preferences.test.ts`; modify `src/styles.css`

Single owner of `theme` (lifted verbatim from `ThemeToggle`'s logic) + `reduceMotion` + `reduceHaptics`, each persisted to localStorage, side effects applied to `<html>`.

- [ ] **Step 1: Write the failing test**

`src/lib/preferences.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "bun:test";
import { applyTheme, readStoredPrefs, type Preferences } from "./preferences.tsx";

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-reduce-motion");
  localStorage.clear();
});

describe("readStoredPrefs", () => {
  it("defaults when nothing stored", () => {
    expect(readStoredPrefs()).toEqual({
      theme: "auto",
      reduceMotion: false,
      reduceHaptics: false,
    });
  });

  it("reads persisted values", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("reduce-motion", "true");
    localStorage.setItem("reduce-haptics", "true");
    expect(readStoredPrefs()).toEqual({
      theme: "dark",
      reduceMotion: true,
      reduceHaptics: true,
    });
  });
});

describe("applyTheme", () => {
  it("sets explicit theme class + data-theme", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("auto removes data-theme", () => {
    applyTheme("auto");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/preferences.test.ts`
Expected: FAIL — module `./preferences.tsx` not found.

- [ ] **Step 3: Implement `src/lib/preferences.tsx`**

```tsx
import * as React from "react";

export type ThemeMode = "light" | "dark" | "auto";

export interface Preferences {
  theme: ThemeMode;
  reduceMotion: boolean;
  reduceHaptics: boolean;
}

const DEFAULTS: Preferences = {
  theme: "auto",
  reduceMotion: false,
  reduceHaptics: false,
};

export function readStoredPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  const t = window.localStorage.getItem("theme");
  return {
    theme: t === "light" || t === "dark" || t === "auto" ? t : "auto",
    reduceMotion: window.localStorage.getItem("reduce-motion") === "true",
    reduceHaptics: window.localStorage.getItem("reduce-haptics") === "true",
  };
}

// Lifted verbatim from the old ThemeToggle.
export function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
  if (mode === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
  document.documentElement.style.colorScheme = resolved;
}

function applyReduceMotion(on: boolean) {
  if (on) document.documentElement.setAttribute("data-reduce-motion", "true");
  else document.documentElement.removeAttribute("data-reduce-motion");
}

interface PreferencesContextValue extends Preferences {
  setTheme: (t: ThemeMode) => void;
  setReduceMotion: (v: boolean) => void;
  setReduceHaptics: (v: boolean) => void;
}

const PreferencesContext = React.createContext<PreferencesContextValue | null>(
  null
);

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = React.useState<Preferences>(DEFAULTS);

  // Hydrate + apply on mount (SSR-safe: no window access during render).
  React.useEffect(() => {
    const stored = readStoredPrefs();
    setPrefs(stored);
    applyTheme(stored.theme);
    applyReduceMotion(stored.reduceMotion);
  }, []);

  // Follow system changes while in auto.
  React.useEffect(() => {
    if (prefs.theme !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [prefs.theme]);

  const setTheme = React.useCallback((theme: ThemeMode) => {
    setPrefs((p) => ({ ...p, theme }));
    applyTheme(theme);
    window.localStorage.setItem("theme", theme);
  }, []);

  const setReduceMotion = React.useCallback((reduceMotion: boolean) => {
    setPrefs((p) => ({ ...p, reduceMotion }));
    applyReduceMotion(reduceMotion);
    window.localStorage.setItem("reduce-motion", String(reduceMotion));
  }, []);

  const setReduceHaptics = React.useCallback((reduceHaptics: boolean) => {
    setPrefs((p) => ({ ...p, reduceHaptics }));
    window.localStorage.setItem("reduce-haptics", String(reduceHaptics));
  }, []);

  const value = React.useMemo<PreferencesContextValue>(
    () => ({ ...prefs, setTheme, setReduceMotion, setReduceHaptics }),
    [prefs, setTheme, setReduceMotion, setReduceHaptics]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = React.useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/lib/preferences.test.ts`
Expected: PASS (4 tests). If `document`/`localStorage` are undefined under `bun test`, prepend the file with a happy-dom/jsdom note — but bun's test env provides them; if not, guard the test with `// @happy-dom` per existing project test conventions (check another DOM-touching test first via `grep -rn "document" src/**/*.test.*`).

- [ ] **Step 5: Add the reduce-motion override to `src/styles.css`**

Append near the existing `@media (prefers-reduced-motion)` rules:
```css
html[data-reduce-motion="true"] *,
html[data-reduce-motion="true"] *::before,
html[data-reduce-motion="true"] *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/preferences.tsx src/lib/preferences.test.ts src/styles.css
git commit -m "feat(preferences): add PreferencesProvider + reduce-motion override"
```

---

### Task 8: web-haptics + HapticsProvider

**Files:** `package.json`; Create `src/lib/haptics.tsx`, `src/lib/haptics.test.ts`

One vanilla `WebHaptics` instance app-wide; `useHaptics()` returns semantic helpers, each a no-op when unsupported or `reduceHaptics`.

- [ ] **Step 1: Install**

Run: `bun add web-haptics`

- [ ] **Step 2: Write the failing test (gating logic is pure, extracted)**

`src/lib/haptics.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { shouldFire } from "./haptics.tsx";

describe("shouldFire", () => {
  it("fires when supported and not reduced", () => {
    expect(shouldFire({ supported: true, reduceHaptics: false })).toBe(true);
  });
  it("no-op when reduced", () => {
    expect(shouldFire({ supported: true, reduceHaptics: true })).toBe(false);
  });
  it("no-op when unsupported", () => {
    expect(shouldFire({ supported: false, reduceHaptics: false })).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test src/lib/haptics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/haptics.tsx`**

```tsx
import * as React from "react";
import { WebHaptics } from "web-haptics";
import { usePreferences } from "./preferences.tsx";

export function shouldFire({
  supported,
  reduceHaptics,
}: {
  supported: boolean;
  reduceHaptics: boolean;
}): boolean {
  return supported && !reduceHaptics;
}

export interface Haptics {
  tick: () => void;
  select: () => void;
  impact: () => void;
}

const HapticsContext = React.createContext<Haptics | null>(null);

export function HapticsProvider({ children }: { children: React.ReactNode }) {
  const { reduceHaptics } = usePreferences();
  const instanceRef = React.useRef<WebHaptics | null>(null);

  React.useEffect(() => {
    if (!WebHaptics.isSupported) return;
    instanceRef.current = new WebHaptics();
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  const value = React.useMemo<Haptics>(() => {
    const fire = (input: Parameters<WebHaptics["trigger"]>[0]) => {
      if (!shouldFire({ supported: WebHaptics.isSupported, reduceHaptics })) return;
      instanceRef.current?.trigger(input);
    };
    return {
      tick: () => fire(10),
      select: () => fire("nudge"),
      impact: () => fire(25),
    };
  }, [reduceHaptics]);

  return (
    <HapticsContext.Provider value={value}>{children}</HapticsContext.Provider>
  );
}

// Safe no-op default if used outside the provider (e.g. isolated tests).
const NOOP: Haptics = { tick: () => {}, select: () => {}, impact: () => {} };

export function useHaptics(): Haptics {
  return React.useContext(HapticsContext) ?? NOOP;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test src/lib/haptics.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/lib/haptics.tsx src/lib/haptics.test.ts
git commit -m "feat(haptics): add web-haptics HapticsProvider + useHaptics"
```

---

### Task 9: Mount providers at the root

**Files:** Modify `src/routes/__root.tsx` (the component that wraps all routes)

- [ ] **Step 1: Locate the root layout wrapper**

Run: `grep -n "data-vaul-drawer-wrapper\|WorkspaceRail\|MobileNav\|<body" src/routes/__root.tsx`
Wrap the existing app shell (the element containing rail + routed content) with the two providers, `PreferencesProvider` outermost (haptics reads it):

```tsx
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { HapticsProvider } from "#/lib/haptics.tsx";
// ...
<PreferencesProvider>
  <HapticsProvider>
    {/* existing shell: rail + <Outlet/> etc. */}
  </HapticsProvider>
</PreferencesProvider>
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat: mount Preferences + Haptics providers at root"
```

---

### Task 10: Base UI Switch primitive

**Files:** Create `src/components/ui/switch.tsx`

coss-ui design on Base UI: pill track + thumb, size via `--thumb-size`, responsive `5`/`sm:4`.

- [ ] **Step 1: Implement**

```tsx
"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "#/lib/utils.ts";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-colors",
        "h-[calc(var(--thumb-size)+4px)] w-[calc(var(--thumb-size)*2+2px)] p-px",
        "[--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]",
        "bg-input data-[checked]:bg-primary",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[var(--thumb-size)] rounded-full bg-background shadow-sm ring-0 transition-transform",
          "data-[unchecked]:translate-x-0 data-[checked]:translate-x-[calc(var(--thumb-size))]"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/switch.tsx
git commit -m "feat(ui): add Base UI switch primitive"
```

---

### Task 11: Base UI ToggleGroup primitive

**Files:** Create `src/components/ui/toggle-group.tsx`

`ToggleGroup` is `string[]`-valued even in single mode (`multiple={false}`). Item children are arbitrary; selected exposes `data-pressed`.

- [ ] **Step 1: Implement**

```tsx
"use client";

import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";

import { cn } from "#/lib/utils.ts";

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/toggle-group.tsx
git commit -m "feat(ui): add Base UI toggle-group primitive"
```

---

### Task 12: ThemePicker preview cards

**Files:** Create `src/components/ThemePicker.tsx`

Three cards in a single-select ToggleGroup. Each renders a **hardcoded-palette** mini dashboard so the preview always shows that theme. System card = diagonal split. Selecting sets theme + fires `impact()`.

- [ ] **Step 1: Implement**

```tsx
import { CheckIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { usePreferences, type ThemeMode } from "#/lib/preferences.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import { cn } from "#/lib/utils.ts";

// Fixed palettes so each preview shows its own theme regardless of active theme.
const LIGHT = { bg: "#ffffff", rail: "#f3f4f6", line: "#111827", muted: "#d1d5db" };
const DARK = { bg: "#0a0a0a", rail: "#1a1a1a", line: "#e5e7eb", muted: "#374151" };

function MiniDashboard({ p }: { p: typeof LIGHT }) {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-md" style={{ background: p.bg }}>
      <div className="h-full w-1/4" style={{ background: p.rail }}>
        <div className="mx-1.5 mt-2 h-1 rounded-full" style={{ background: p.muted }} />
        <div className="mx-1.5 mt-1 h-1 w-2/3 rounded-full" style={{ background: p.muted }} />
      </div>
      <div className="flex-1 p-2">
        <svg viewBox="0 0 40 20" className="h-full w-full" preserveAspectRatio="none">
          <polyline
            points="0,16 8,12 16,14 24,6 32,9 40,3"
            fill="none"
            stroke={p.line}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

const OPTIONS: { value: ThemeMode; label: string; node: React.ReactNode }[] = [
  { value: "light", label: "Light", node: <MiniDashboard p={LIGHT} /> },
  { value: "dark", label: "Dark", node: <MiniDashboard p={DARK} /> },
  {
    value: "auto",
    label: "System",
    node: (
      <div className="relative h-full w-full">
        <div className="absolute inset-0" style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}>
          <MiniDashboard p={LIGHT} />
        </div>
        <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
          <MiniDashboard p={DARK} />
        </div>
      </div>
    ),
  },
];

export function ThemePicker() {
  const { theme, setTheme } = usePreferences();
  const { impact } = useHaptics();

  return (
    <ToggleGroup
      value={[theme]}
      onValueChange={(v: string[]) => {
        const next = v[0] as ThemeMode | undefined;
        if (next && next !== theme) {
          setTheme(next);
          impact();
        }
      }}
      className="grid grid-cols-3 gap-3"
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.label}
          className={cn(
            "group relative flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-2 transition-all",
            "hover:border-border data-[pressed]:border-primary data-[pressed]:ring-2 data-[pressed]:ring-primary/30"
          )}
        >
          <div className="aspect-[4/3] w-full overflow-hidden rounded-md ring-1 ring-border/40">
            {o.node}
          </div>
          <span className="text-center text-xs font-medium text-foreground">{o.label}</span>
          <span className="absolute right-2 top-2 hidden size-4 items-center justify-center rounded-full bg-primary text-primary-foreground group-data-[pressed]:flex">
            <CheckIcon className="size-2.5" />
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ThemePicker.tsx
git commit -m "feat: add ThemePicker preview cards"
```

---

### Task 13: Preferences modal

**Files:** Create `src/components/Preferences.tsx`

Mirrors proof-viewer: Base UI Dialog (desktop) / vaul Drawer (mobile) via `useMediaQuery`. Controlled by parent open state. Body = ThemePicker + two Switch rows.

- [ ] **Step 1: Implement**

```tsx
import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { ThemePicker } from "./ThemePicker";
import { usePreferences } from "#/lib/preferences.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Body() {
  const { reduceMotion, reduceHaptics, setReduceMotion, setReduceHaptics } =
    usePreferences();
  const { impact } = useHaptics();
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Theme
        </div>
        <ThemePicker />
      </div>
      <Separator />
      <div className="space-y-4">
        <SwitchRow
          label="Reduce motion"
          description="Minimize animations and transitions."
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        <SwitchRow
          label="Reduce haptics"
          description="Turn off vibration feedback."
          checked={reduceHaptics}
          onChange={(v) => {
            // Fire one last tick when re-enabling, for confirmation.
            if (!v) impact();
            setReduceHaptics(v);
          }}
        />
      </div>
    </div>
  );
}

export function Preferences({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background p-6 shadow-xl transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-base font-medium">Preferences</Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Theme, motion, and haptics settings.
            </Dialog.Description>
            <Body />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <DrawerContent className="h-[70vh]">
        <div className="px-5 pt-2 pb-8">
          <DrawerTitle className="mb-4 text-base font-medium">Preferences</DrawerTitle>
          <DrawerDescription className="sr-only">
            Theme, motion, and haptics settings.
          </DrawerDescription>
          <Body />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/Preferences.tsx
git commit -m "feat: add Preferences modal"
```

---

### Task 14: Rail gear trigger; delete ThemeToggle

**Files:** Modify `src/components/WorkspaceRail.tsx`; delete `src/components/ThemeToggle.tsx`

`RailContent` is shared by desktop rail + mobile drawer, so one change covers both. Replace the `<ThemeToggle />` in the footer with a gear button that owns `open` state and renders `<Preferences/>`.

- [ ] **Step 1: Edit `WorkspaceRail.tsx`**

Replace the import:
```tsx
// delete: import ThemeToggle from "./ThemeToggle";
import { useState } from "react";
import { SettingsIcon } from "lucide-react";
import { Preferences } from "./Preferences";
```
In `RailContent`, add state at the top of the component body:
```tsx
  const [prefsOpen, setPrefsOpen] = useState(false);
```
Replace `<ThemeToggle />` (footer, ~line 118) with:
```tsx
          <button
            type="button"
            onClick={() => setPrefsOpen(true)}
            aria-label="Preferences"
            title="Preferences"
            className="grid place-items-center rounded-full border border-border/60 bg-background p-2 text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </button>
          <Preferences open={prefsOpen} onOpenChange={setPrefsOpen} />
```

- [ ] **Step 2: Delete ThemeToggle**

Run: `git rm src/components/ThemeToggle.tsx`
Then confirm no stragglers: `grep -rn "ThemeToggle" src/` → expected no results.

- [ ] **Step 3: Typecheck + manual verify**

Run: `bunx tsc --noEmit`
Manual (`bun dev`): click the gear in the rail footer → modal opens. On mobile width, open the nav drawer → gear → bottom sheet opens. Switch theme via the cards (live), toggle reduce-motion (animations stop), toggle reduce-haptics.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat: open Preferences from rail; remove ThemeToggle"
```

---

### Task 15: Chart scrub ticks

**Files:** Modify `src/components/charts/use-chart-interaction.ts`

Fire `tick()` when the resolved data-point index changes during a scrub; `select()` on selection start. Throttle to index-change (not per-pixel) so iOS stays sane.

- [ ] **Step 1: Add haptics + last-index ref**

After the imports, add:
```tsx
import { useHaptics } from "#/lib/haptics.tsx";
```
Inside the hook body, near the other refs (after line 72):
```tsx
  const { tick, select } = useHaptics();
  const lastIndexRef = useRef<number>(-1);
```

- [ ] **Step 2: Tick on index change in `handleMouseMove` (non-drag path)**

In `handleMouseMove`, replace the `const tooltip = resolveTooltipFromX(chartX); if (tooltip) { scheduleTooltip(tooltip); }` tail with:
```tsx
      const tooltip = resolveTooltipFromX(chartX);
      if (tooltip) {
        if (tooltip.index !== lastIndexRef.current) {
          lastIndexRef.current = tooltip.index;
          tick();
        }
        scheduleTooltip(tooltip);
      }
```
Add `tick` to that callback's dep array.

- [ ] **Step 3: Same tick logic in `handleTouchMove` (single-touch path)**

In the `event.touches.length === 1` branch of `handleTouchMove`, wrap the tooltip the same way:
```tsx
        const tooltip = resolveTooltipFromX(chartX, );
        if (tooltip) {
          if (tooltip.index !== lastIndexRef.current) {
            lastIndexRef.current = tooltip.index;
            tick();
          }
          scheduleTooltip(tooltip);
        }
```
Add `tick` to the dep array.

- [ ] **Step 4: `select()` + reset on starts/ends**

- In `handleMouseDown`: after `isDraggingRef.current = true;` add `select();` and `lastIndexRef.current = -1;`. Add `select` to deps.
- In `handleTouchStart` single-touch branch: after computing a valid tooltip, on the first move it'll tick; on the 2-finger selection branch add `select();`. Add `select` to deps.
- In `handleMouseLeave`, `handleMouseUp`, `handleTouchEnd`: add `lastIndexRef.current = -1;` so the next scrub starts fresh.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual verify (device or DevTools touch + a real phone if possible)**

`bun dev`, open a ticker chart. Scrub across points: a tick per crossed data point (felt on a supporting device; on desktop it's a silent no-op unless `navigator.vibrate` exists). Start a drag-selection → one firmer `nudge`.

- [ ] **Step 7: Commit**

```bash
git add src/components/charts/use-chart-interaction.ts
git commit -m "feat(charts): haptic ticks on chart scrub"
```

---

### Task 16: Tab / drawer / row haptics

**Files:** Modify the ticker route (timeframe tabs), the call-row component, and `proof-viewer.tsx`

- [ ] **Step 1: Locate the touch points**

Run: `grep -rn "timeframe\|setTimeframe\|onValueChange\|TabsTrigger\|t-tab" src/routes/c.\$handle.ticker.\$symbol.tsx`
Run: `grep -rn "onClick" src/routes/c.\$handle.ticker.\$symbol.tsx | grep -i "row\|call\|setSelected\|setProof"`

- [ ] **Step 2: Timeframe switch → `impact()`**

In the ticker route component: `const { impact } = useHaptics();` then call `impact()` inside the timeframe-change handler (whatever sets the active timeframe).

- [ ] **Step 3: Call-row tap → `select()`**

In the handler that opens the proof viewer for a row (sets the selected `Call`), add `select()`. Use `const { select } = useHaptics();` in that component.

- [ ] **Step 4: Proof drawer open → `impact()`**

This is covered transitively by the row tap (`select()`); do NOT also add `impact()` on open or it double-fires. Leave proof-viewer as-is for haptics. (Documented here so the "drawer open" intent from the spec is satisfied by the row tap.)

- [ ] **Step 5: Typecheck + manual verify**

Run: `bunx tsc --noEmit`
Manual: switching timeframe gives a tap; tapping a call row gives a nudge then opens the proof.

- [ ] **Step 6: Commit**

```bash
git add src/routes/c.\$handle.ticker.\$symbol.tsx
git commit -m "feat(haptics): tab switch + call-row feedback"
```

---

### Task 17: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + tests**

Run: `bunx tsc --noEmit && bun test`
Expected: clean; preferences + haptics tests pass.

- [ ] **Step 2: No radix left**

Run: `grep -rn "radix" src/ package.json`
Expected: no results.

- [ ] **Step 3: Build**

Run: `bun run build` (or the project's build per CLAUDE.md: prebuild + vite build)
Expected: succeeds.

- [ ] **Step 4: Manual smoke on mobile width**

`bun dev`, DevTools device mode + a real device if available: theme cards switch live, reduce-motion stops animations, reduce-haptics silences ticks, chart scrub ticks, proof drawer + nav drawer still drag-to-dismiss, scroll-area fades correct on all three surfaces.

---

## Self-Review notes

- **Spec coverage:** PreferencesProvider (T7), reduce-motion CSS (T7), web-haptics + gating (T8), provider mount (T9), switch (T10), toggle-group (T11), ThemePicker cards (T12), modal (T13), rail trigger + ThemeToggle delete (T14), chart ticks (T15), tab/row (T16), Base UI migration incl. scroll-area mask + keep-vaul (T0-T6), CLAUDE.md provenance (T6). All spec items mapped.
- **"Drawer open → impact"** from the spec is intentionally folded into the row-tap `select()` (T16 Step 4) to avoid double-fire — noted, not dropped.
- **Naming:** `tick`/`select`/`impact` consistent across haptics.tsx, ThemePicker, Preferences, use-chart-interaction. `usePreferences` fields (`theme`, `reduceMotion`, `reduceHaptics`, `setTheme`, `setReduceMotion`, `setReduceHaptics`) consistent across consumers.
- **Risk flagged in spec:** iOS rapid-tick coalescing — mitigated by index-change throttle (T15).
- **DOM-in-tests caveat:** T7 Step 4 / T8 verify whether `bun test` exposes `document`/`localStorage`; haptics test is pure (`shouldFire`) to avoid the dependency.
