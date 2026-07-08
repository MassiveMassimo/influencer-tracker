# Web haptics + Preferences modal — design

Date: 2026-06-04
Branch: `mobile-responsive-lina` (mobile-polish work; haptics fits here, no worktree)

## Goal

Add tasteful haptic feedback to the mobile web app (ticks while scrubbing the
chart, plus a few curated touch points), and a Preferences modal — opened from
the sidebar — that controls theme, reduce-motion, and reduce-haptics.

Library: [`web-haptics`](https://github.com/lochie/web-haptics) — `bun add web-haptics`.
Android uses `navigator.vibrate`; iOS Safari uses the lib's hidden switch-input
Taptic hack (the real win — `navigator.vibrate` doesn't exist on iOS).

UI primitive layer migrates radix → **Base UI** (`@base-ui-components/react`)
first, so the new components are built natively on Base UI (coss-ui is built on
Base UI; no more reimplementing-on-radix).

## Phase 0 — radix → Base UI migration (do first)

Convert the radix-based primitives. Decisions:

- **Keep vaul** (`drawer.tsx`, `MobileNav`, proof-viewer mobile, root wrapper) —
  not radix, no Base UI equivalent, keeps drag-to-dismiss + background scale.
- **Port the lina scroll-area** to Base UI `ScrollArea` and re-implement the
  adaptive edge-fade mask (`--scroll-mask-color`/`maskColor`), the `h-auto`
  autosize, and re-verify all 3 wired surfaces (ticker table, proof drawer body,
  `WorkspaceRail` nav).

Migration targets:

| File                 | radix today                   | → Base UI                             |
| -------------------- | ----------------------------- | ------------------------------------- |
| `proof-viewer.tsx`   | `Dialog`, `VisuallyHidden`    | Base UI `Dialog` parts                |
| `ui/badge.tsx`       | `Slot` (`asChild`)            | Base UI `render` prop (no Slot)       |
| `ui/accordion.tsx`   | `Accordion`                   | Base UI `Accordion`                   |
| `ui/separator.tsx`   | `Separator`                   | Base UI `Separator`                   |
| `ui/scroll-area.tsx` | `@radix-ui/react-scroll-area` | Base UI `ScrollArea` + re-ported mask |

Remove `radix-ui` + `@radix-ui/react-scroll-area` from `package.json` once no
imports remain. Update `CLAUDE.md` "Component provenance" — the note that
primitives are radix/shadcn-style "not coss-ui (Base UI)" is now inverted: they
ARE Base UI. `asChild` → Base UI `render` ripples to call sites (e.g.
`Dialog.Close asChild`); verify each.

Confirm exact Base UI part names/APIs from base-ui.com docs at implementation
time (Dialog, ScrollArea, Accordion, Separator, Switch, ToggleGroup, render prop).

## Components (built on Base UI)

### 1. `src/lib/preferences.tsx` — `PreferencesProvider` + `usePreferences()`

Single source of truth for three prefs, each persisted to `localStorage`:

- `theme: 'light' | 'dark' | 'auto'` — lifts the existing logic out of
  `ThemeToggle.tsx` verbatim (class on `<html>`, `data-theme` attr, the `auto`
  system `matchMedia` listener). One owner instead of two.
- `reduceMotion: boolean` — toggles `html[data-reduce-motion="true"]`.
- `reduceHaptics: boolean` — read by the haptics layer.

SSR-safe (no `window` access during render; apply in effect, mirroring current
`ThemeToggle` init).

### 2. `src/styles.css` — make reduce-motion mean something

Current `@media (prefers-reduced-motion)` rules only cover 3 classes. Add a broad
override gated on the manual attribute (existing OS-media rules stay):

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

### 3. `bun add web-haptics` + `src/lib/haptics.tsx` — `HapticsProvider` + `useHaptics()`

One vanilla `WebHaptics` instance app-wide (iOS switch hack injects DOM once),
created in an effect. `useHaptics()` returns gated semantic helpers — each a
no-op when `!WebHaptics.isSupported || preferences.reduceHaptics`:

- `tick()` → ~10ms light tap — chart data-point crossing while scrubbing
- `select()` → `"nudge"` preset — selection start, call-row tap
- `impact()` → short tap — timeframe tab switch, proof drawer open

### 4. `src/components/ui/switch.tsx` (new) — Base UI Switch

coss-ui Switch on Base UI `Switch.Root` + `Switch.Thumb`: pill track + sliding
thumb, size via `--thumb-size` CSS var, responsive
(`[--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]`).

### 5. `src/components/ui/toggle-group.tsx` (new) — Base UI ToggleGroup

`ToggleGroup` (single) on Base UI `ToggleGroup` + `Toggle`. Items accept
arbitrary children + expose `data-pressed` for selected styling. Used by the
theme picker.

### 6. `src/components/ThemePicker.tsx` (new) — preview-card theme switcher

`ToggleGroup` (single, value = `theme`) of three cards: Light / Dark / System.
Each card renders a small **hardcoded-palette** dashboard mock (faux sidebar +
chart line) so the preview always shows _that_ theme regardless of the active
one — Apple/modern theme-switcher style. System card = diagonal light/dark split.
Selected card → ring + check badge. Label under each. Selecting calls
`usePreferences().setTheme` and `impact()`.

### 7. `src/components/Preferences.tsx` (new) — the modal

Mirrors `proof-viewer.tsx`: Radix `Dialog` on desktop, vaul `Drawer` on mobile,
switched via `useMediaQuery("(min-width: 768px)")`. Body:

- ThemePicker (preview cards)
- Reduce motion — `Switch` row (label + description)
- Reduce haptics — `Switch` row

### 8. Rail wiring

`WorkspaceRail.tsx` footer: replace the standalone `ThemeToggle` button with a
gear "Preferences" trigger that opens the modal. Works in both the desktop rail
and the mobile `RailContent` (inside `MobileNav`'s drawer). `ThemeToggle.tsx`
becomes unused → delete (its logic now lives in `PreferencesProvider`).

### 9. Provider mounting

Mount `PreferencesProvider` then `HapticsProvider` near the app root
(`src/router.tsx` / root route) so both contexts wrap all routes.

## Haptic wire-in points (scope: chart + key touch points)

- `src/components/charts/use-chart-interaction.ts`: add `lastIndexRef`. On
  touch-move / mouse-move scrub, when the resolved point index changes, fire
  `tick()`. On drag/selection start (`handleMouseDown`, 2-finger
  `handleTouchStart`), fire `select()`. Reset `lastIndexRef` on leave/end.
  (Hook takes haptic callbacks via params, or reads `useHaptics()` directly —
  prefer reading the hook to keep call sites clean.)
- Timeframe tab switch (ticker route) → `impact()`
- Proof drawer open → `impact()`
- Call-row tap that opens proof → `select()`

## Known risk

iOS rapid scrub-ticks ride the switch-input Taptic hack; Safari may coalesce
very fast repeated toggles, so ticks can feel slightly less crisp than native
during a fast drag. Throttling to index-change (not per-pixel) keeps it sane on
both platforms. Android `navigator.vibrate` handles rapid ticks cleanly.

## Out of scope

Broad haptics on every nav/button. No haptics settings beyond the on/off toggle.
No new settings surface beyond this modal.
