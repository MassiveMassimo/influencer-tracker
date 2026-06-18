# Ticker-Primary Page + Creator Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the stock ticker the top-level page (`/t/$symbol/$creator`), with a creator-switcher (avatar tabs + morphing search combobox), a cross-creator "who called it" table, and a simple timeline swimlane — while old per-creator URLs redirect in.

**Architecture:** One route `/t/$symbol/$creator` carries the selected creator as a **path param** (`all` = cross-creator view). A path param (not a search param) keeps ISR cache-keying and OG scrapers working, and keeps the route component mounted across switches so the charts never replay their entrance. `/t/$symbol` and the old `/c/$handle/ticker/$symbol` redirect into it.

**Tech Stack:** TanStack Start (file-based routing, `createFileRoute`/`redirect`), React, TanStack Query, `@base-ui/react` Tooltip (via `ui/tooltip.tsx`), vendored bklit charts, custom SVG for the timeline, `bun test`, Tailwind v4 + `styles.css`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-ticker-primary-creator-switcher-design.md` (authoritative; re-read for any ambiguity).
- Tests run on `bun test`; typecheck with `bunx tsc --noEmit`. The `#/` alias maps to `src/`.
- **No new runtime dependency.** Timeline is custom SVG; combobox is a plain input + filtered list; tooltip reuses `ui/tooltip.tsx`.
- **Creator is a PATH param**, never a search param. `creator === "all"` is the reserved cross-creator sentinel.
- **Uppercase `$symbol`** in every redirect and in the new loader (OG route matches ticker case-sensitively; ISR keys are case-split).
- Redirects use `replace: true`.
- OG image URL is built in the **loader** and read via `loaderData` in `head` (`head` receives no `search`/derived state). Keep the `<rev>` cache-buster segment.
- `firstDate` (chart window start, part of the `chartQuery` key) is the **cross-creator earliest call date for the symbol in BOTH modes**, so the chart query key is creator-independent.
- `src/routeTree.gen.ts` is **auto-generated** by the TanStack vite plugin — never hand-edit it; it regenerates on `bun run dev` / `vite build`.
- Code-comment style: no first-person, sentence case, `//` single space, intent not narration.
- Commit after every task. Branch: `ticker-primary` (worktree `../influencer-tracker-ticker-primary`).

---

## File Structure

- `src/lib/call-filter.ts` (modify) — add `lastCallDate` to `TickerCreatorRow`, populate in `summarizeTicker`.
- `src/lib/call-filter.test.ts` (modify) — assert `lastCallDate`.
- `src/lib/ticker-switcher.ts` (create) — pure `pickAvatarTabs()` ordering/cap helper.
- `src/lib/ticker-switcher.test.ts` (create) — unit tests.
- `src/lib/call-timeline-layout.ts` (create) — pure `timelineXPercent()` + `timelineTicks()`.
- `src/lib/call-timeline-layout.test.ts` (create) — unit tests.
- `src/components/ticker/creator-switcher.tsx` (create) — avatar tabs + morphing search combobox.
- `src/components/ticker/call-timeline.tsx` (create) — SVG swimlane with hover crosshair.
- `src/styles.css` (modify) — small additions for switcher avatars + combobox dropdown (reuses `.t-tabs*`).
- `src/routes/t.$symbol.$creator.tsx` (create) — the full ticker page (loader + head + component).
- `src/routes/t.$symbol.index.tsx` (create) — exact `/t/$symbol` → redirect `/t/$symbol/all`.
- `src/routes/t.$symbol.tsx` (delete) — replaced by the two files above.
- `src/routes/c.$handle.ticker.$symbol.tsx` (modify) — replace body with a redirect.
- `src/routes/c.$handle.index.tsx` (modify, line ~440) — update Link to new route.
- `src/routes/explore.tsx` (modify, line ~122) — update Link to new route.

---

## Task 1: `lastCallDate` on `TickerCreatorRow`

**Files:**
- Modify: `src/lib/call-filter.ts` (interface `TickerCreatorRow` ~line 51; `summarizeTicker` map ~line 84)
- Test: `src/lib/call-filter.test.ts`

**Interfaces:**
- Produces: `TickerCreatorRow.lastCallDate: string | null` — the max `postDate` across that creator's calls for the ticker. Consumed by Task 6 (switcher data) and Task 2 (ordering).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/call-filter.test.ts` (the `summarizeTicker` ROWS fixture has alice calling NVDA on 2026-05-03 only; add another alice NVDA call so max differs from first):

```ts
test("summarizeTicker emits lastCallDate = max postDate per creator", () => {
  const rows: CallIndexEntry[] = [
    e({ shortcode: "a1", handle: "alice", ticker: "NVDA", postDate: "2026-05-03", isFirstCall: true }),
    e({ shortcode: "a2", handle: "alice", ticker: "NVDA", postDate: "2026-06-10", isFirstCall: false }),
    e({ shortcode: "b1", handle: "bob", ticker: "NVDA", postDate: "2026-05-20", isFirstCall: true }),
  ];
  const s = summarizeTicker(rows, "NVDA");
  const alice = s.byCreator.find((b) => b.handle === "alice")!;
  const bob = s.byCreator.find((b) => b.handle === "bob")!;
  expect(alice.firstCallDate).toBe("2026-05-03");
  expect(alice.lastCallDate).toBe("2026-06-10");
  expect(bob.lastCallDate).toBe("2026-05-20");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/call-filter.test.ts`
Expected: FAIL — `lastCallDate` is `undefined` (property does not exist on the row).

- [ ] **Step 3: Add the field to the interface**

In `src/lib/call-filter.ts`, add to `TickerCreatorRow` (after `firstCallDate`):

```ts
  firstCallDate: string | null; // earliest first-call postDate for this ticker
  lastCallDate: string | null; // latest postDate for this ticker
```

- [ ] **Step 4: Populate it in `summarizeTicker`**

In the `byCreator` map (inside `summarizeTicker`), add `lastCallDate` to the returned object:

```ts
  const byCreator: TickerCreatorRow[] = [...byHandle.entries()].map(([handle, cs]) => {
    const first = cs.find((c) => c.isFirstCall) ?? [...cs].sort((a, b) => a.postDate.localeCompare(b.postDate))[0];
    return {
      handle,
      callCount: cs.length,
      firstCallDate: first?.postDate ?? null,
      lastCallDate: cs.reduce<string | null>((m, c) => (m == null || c.postDate > m ? c.postDate : m), null),
      bestEx3m: cs.reduce<number | null>((m, c) => (c.ex3m != null && (m == null || c.ex3m > m) ? c.ex3m : m), null),
      ex3m: first?.ex3m ?? null,
      exToDate: first?.exToDate ?? null,
    };
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/lib/call-filter.test.ts`
Expected: PASS (new test + all existing call-filter tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/call-filter.ts src/lib/call-filter.test.ts
git commit -m "feat(ticker): add lastCallDate to TickerCreatorRow"
```

---

## Task 2: `pickAvatarTabs` switcher-ordering helper

**Files:**
- Create: `src/lib/ticker-switcher.ts`
- Test: `src/lib/ticker-switcher.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SwitcherCreator {
    handle: string;
    name: string;
    avatar: string | null;
    lastCallDate: string | null;
    callCount: number;
  }
  export function pickAvatarTabs(
    creators: SwitcherCreator[],
    selected: string | null,
    max?: number, // default 3
  ): SwitcherCreator[];
  ```
  Order: selected creator first (if present in `creators`), then the most-recent *other* callers by `lastCallDate` desc (ties broken by `handle` asc), capped at `max` total. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ticker-switcher.test.ts`:

```ts
import { test, expect } from "bun:test";
import { pickAvatarTabs, type SwitcherCreator } from "./ticker-switcher";

function c(handle: string, lastCallDate: string): SwitcherCreator {
  return { handle, name: handle, avatar: null, lastCallDate, callCount: 1 };
}
const CREATORS: SwitcherCreator[] = [
  c("alice", "2026-01-01"),
  c("bob", "2026-06-01"),
  c("carol", "2026-03-01"),
  c("dave", "2026-05-01"),
];

test("no selection: 3 most-recent by lastCallDate desc", () => {
  expect(pickAvatarTabs(CREATORS, null).map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("selected creator is pinned first, rest fill by recency", () => {
  expect(pickAvatarTabs(CREATORS, "alice").map((x) => x.handle)).toEqual(["alice", "bob", "dave"]);
});

test("selected already-recent is not duplicated", () => {
  expect(pickAvatarTabs(CREATORS, "bob").map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("selected handle absent from list is ignored", () => {
  expect(pickAvatarTabs(CREATORS, "zzz").map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("null lastCallDate sorts last", () => {
  const list = [c("a", "2026-01-01"), { ...c("b", ""), lastCallDate: null }];
  expect(pickAvatarTabs(list, null).map((x) => x.handle)).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ticker-switcher.test.ts`
Expected: FAIL — module `./ticker-switcher` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/ticker-switcher.ts`:

```ts
export interface SwitcherCreator {
  handle: string;
  name: string;
  avatar: string | null;
  lastCallDate: string | null;
  callCount: number;
}

// Most-recent first by lastCallDate (nulls last), ties by handle asc.
function byRecency(a: SwitcherCreator, b: SwitcherCreator): number {
  const ad = a.lastCallDate ?? "";
  const bd = b.lastCallDate ?? "";
  if (ad !== bd) return bd.localeCompare(ad);
  return a.handle.localeCompare(b.handle);
}

// Avatar tabs for the switcher: selected creator pinned first (when it is a
// caller), then the most-recent other callers, capped at `max` total.
export function pickAvatarTabs(
  creators: SwitcherCreator[],
  selected: string | null,
  max = 3,
): SwitcherCreator[] {
  const sel = selected ? creators.find((c) => c.handle === selected) ?? null : null;
  const rest = creators.filter((c) => c.handle !== sel?.handle).sort(byRecency);
  const ordered = sel ? [sel, ...rest] : rest;
  return ordered.slice(0, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ticker-switcher.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ticker-switcher.ts src/lib/ticker-switcher.test.ts
git commit -m "feat(ticker): pickAvatarTabs switcher-ordering helper"
```

---

## Task 3: Timeline layout helpers

**Files:**
- Create: `src/lib/call-timeline-layout.ts`
- Test: `src/lib/call-timeline-layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // 0..100, clamped. start===end → 50 (avoid divide-by-zero).
  export function timelineXPercent(dateMs: number, startMs: number, endMs: number): number;
  // start / mid / end ticks as {label: "YYYY-MM", pct} for axis labels.
  export function timelineTicks(startMs: number, endMs: number): { label: string; pct: number }[];
  ```
  Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/lib/call-timeline-layout.test.ts`:

```ts
import { test, expect } from "bun:test";
import { timelineXPercent, timelineTicks } from "./call-timeline-layout";

const start = Date.UTC(2026, 0, 1); // 2026-01-01
const end = Date.UTC(2026, 11, 31); // 2026-12-31

test("xPercent maps start->0, end->100, midpoint->~50", () => {
  expect(timelineXPercent(start, start, end)).toBe(0);
  expect(timelineXPercent(end, start, end)).toBe(100);
  const mid = start + (end - start) / 2;
  expect(Math.round(timelineXPercent(mid, start, end))).toBe(50);
});

test("xPercent clamps out-of-range and handles zero-width", () => {
  expect(timelineXPercent(start - 1e9, start, end)).toBe(0);
  expect(timelineXPercent(end + 1e9, start, end)).toBe(100);
  expect(timelineXPercent(start, start, start)).toBe(50);
});

test("ticks return start/mid/end with YYYY-MM labels and pct 0/50/100", () => {
  const ticks = timelineTicks(start, end);
  expect(ticks.map((t) => t.pct)).toEqual([0, 50, 100]);
  expect(ticks[0].label).toBe("2026-01");
  expect(ticks[2].label).toBe("2026-12");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/call-timeline-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/call-timeline-layout.ts`:

```ts
// Horizontal position (0..100%) of a date within [start, end], clamped.
// Zero-width range collapses to the centre so a single-date row still renders.
export function timelineXPercent(dateMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 50;
  const pct = ((dateMs - startMs) / (endMs - startMs)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function ym(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

// Start / mid / end axis ticks.
export function timelineTicks(startMs: number, endMs: number): { label: string; pct: number }[] {
  const mid = startMs + (endMs - startMs) / 2;
  return [
    { label: ym(startMs), pct: 0 },
    { label: ym(mid), pct: 50 },
    { label: ym(endMs), pct: 100 },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/call-timeline-layout.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/call-timeline-layout.ts src/lib/call-timeline-layout.test.ts
git commit -m "feat(ticker): timeline layout helpers (xPercent, ticks)"
```

---

## Task 4: `CreatorSwitcher` component + CSS

**Files:**
- Create: `src/components/ticker/creator-switcher.tsx`
- Modify: `src/styles.css` (append a switcher block)

**Interfaces:**
- Consumes: `pickAvatarTabs`, `SwitcherCreator` (Task 2); `Tooltip`, `TooltipTrigger`, `TooltipPopup` from `#/components/ui/tooltip.tsx`; `useNavigate` from `@tanstack/react-router`; lucide `Search`, `Users`.
- Produces:
  ```ts
  export function CreatorSwitcher(props: {
    symbol: string;                 // already uppercased
    creators: SwitcherCreator[];    // all callers of the symbol
    selected: string | null;        // null = "all" active
  }): React.ReactElement | null;    // null when creators.length <= 1
  ```
  Consumed by Task 6. Navigates to `/t/$symbol/$creator` (`creator="all"` or a handle).

**No unit test** (repo has no React-render harness): verified by `bunx tsc --noEmit` here and a visual pass on `main` (Task 7 handoff). Logic is already covered by Task 2.

- [ ] **Step 1: Append switcher CSS to `src/styles.css`**

Add at the end of `src/styles.css` (reuses the `.t-tabs`/`.t-tab`/`.t-tabs-pill` pill mechanic already defined above it):

```css
/* Creator switcher: avatar tabs + search-tab that morphs into a combobox.
   Built on the .t-tabs pill; the pill expands to full width to become the
   combobox background (see creator-switcher.tsx). */
.cs-avatar {
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  object-fit: cover;
  display: block;
}
.cs-avatar-fallback {
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  text-transform: uppercase;
  background: color-mix(in oklab, var(--foreground) 6%, transparent);
}
/* Combobox overlay sits on top of the full-width pill while open. */
.cs-combobox {
  position: absolute;
  inset: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 48px;
  z-index: 2;
}
.cs-combobox input {
  flex: 1 1 auto;
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 13px;
  color: var(--foreground);
}
.cs-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  z-index: 30;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--popover);
  box-shadow: 0 8px 30px rgb(0 0 0 / 12%);
  padding: 4px;
}
.cs-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
}
.cs-option:hover,
.cs-option[data-active="true"] {
  background: color-mix(in oklab, var(--foreground) 4%, transparent);
}
```

- [ ] **Step 2: Create the component**

Create `src/components/ticker/creator-switcher.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { pickAvatarTabs, type SwitcherCreator } from "#/lib/ticker-switcher.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip.tsx";

function Avatar({ creator }: { creator: SwitcherCreator }) {
  return creator.avatar ? (
    <img src={creator.avatar} alt="" className="cs-avatar" />
  ) : (
    <span className="cs-avatar-fallback">{creator.handle.slice(0, 2)}</span>
  );
}

export function CreatorSwitcher({
  symbol,
  creators,
  selected,
}: {
  symbol: string;
  creators: SwitcherCreator[];
  selected: string | null;
}) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  // Switcher only earns its place with someone to switch to.
  if (creators.length <= 1) return null;

  const tabs = pickAvatarTabs(creators, selected, 3);
  const go = (creator: string) =>
    navigate({ to: "/t/$symbol/$creator", params: { symbol, creator } });

  // Position the pill under the active tab; when the combobox is open the pill
  // expands to fill the whole container and becomes the combobox background.
  const positionPill = (animate: boolean) => {
    const list = listRef.current, pill = pillRef.current;
    if (!list || !pill) return;
    const apply = (left: number, width: number) => {
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
    };
    if (!animate) pill.style.transition = "none";
    if (open) {
      apply(0, list.clientWidth - 6); // inset 3px both sides
    } else {
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (active) apply(active.offsetLeft, active.offsetWidth);
    }
    if (!animate) {
      void pill.offsetWidth; // force reflow before re-enabling transition
      pill.style.transition = "";
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: snap on mount + resize
  useLayoutEffect(() => {
    positionPill(false);
    const onResize = () => positionPill(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-position on state change
  useLayoutEffect(() => {
    positionPill(true);
    if (open) inputRef.current?.focus();
  }, [open, selected]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!listRef.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const filtered = creators
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.handle.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.lastCallDate ?? "").localeCompare(a.lastCallDate ?? ""));

  return (
    <div className="relative">
      <div className="t-tabs" role="tablist" ref={listRef}>
        <span className="t-tabs-pill" aria-hidden="true" ref={pillRef} />

        {!open && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={selected === null}
              className="t-tab font-mono"
              onClick={() => go("all")}
            >
              All
            </button>
            {tabs.map((c) => (
              <Tooltip key={c.handle}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected === c.handle}
                      aria-label={c.name}
                      className="t-tab"
                      onClick={() => go(c.handle)}
                    >
                      <Avatar creator={c} />
                    </button>
                  }
                />
                <TooltipPopup>{c.name}</TooltipPopup>
              </Tooltip>
            ))}
            <button
              type="button"
              aria-label="Search creators"
              className="t-tab"
              onClick={() => { setQ(""); setOpen(true); }}
            >
              <Search size={15} />
            </button>
          </>
        )}

        {open && (
          <div className="cs-combobox">
            <Search size={15} className="text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              placeholder="Search creators…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            />
          </div>
        )}
      </div>

      {open && (
        <div className="cs-panel" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No creators match.</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.handle}
                type="button"
                role="option"
                aria-selected={selected === c.handle}
                data-active={selected === c.handle}
                className="cs-option"
                onClick={() => { setOpen(false); go(c.handle); }}
              >
                <Avatar creator={c} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{c.name}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {c.callCount} call{c.callCount === 1 ? "" : "s"} · last {c.lastCallDate ?? "—"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

> NOTE on `TooltipTrigger render={...}`: Base UI's Trigger renders its child via the
> `render` prop (mirrors `WorkspaceRail.tsx` usage). If `tsc` flags the `render`
> signature, fall back to `<TooltipTrigger asChild>` per the version's API — check
> `WorkspaceRail.tsx:187-196` for the exact in-repo pattern and match it.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors referencing `creator-switcher.tsx`). If the Tooltip trigger API differs, align with `WorkspaceRail.tsx` and re-run.

- [ ] **Step 4: Commit**

```bash
git add src/components/ticker/creator-switcher.tsx src/styles.css
git commit -m "feat(ticker): CreatorSwitcher (avatar tabs + morphing search combobox)"
```

---

## Task 5: `TickerCallTimeline` component

**Files:**
- Create: `src/components/ticker/call-timeline.tsx`

**Interfaces:**
- Consumes: `timelineXPercent`, `timelineTicks` (Task 3).
- Produces:
  ```ts
  export interface TimelineCreator {
    handle: string;
    name: string;
    avatar: string | null;
    calls: { postDate: string; isFirstCall: boolean }[];
  }
  export function TickerCallTimeline(props: {
    creators: TimelineCreator[]; // rows, in the table's order
    rangeStart: string;          // YYYY-MM-DD (cross-creator earliest)
    rangeEnd: string;            // YYYY-MM-DD (today)
  }): React.ReactElement | null; // null when no creators
  ```
  Consumed by Task 6.

**No unit test** (presentational); dot math is covered by Task 3. Verified by typecheck + visual pass.

- [ ] **Step 1: Create the component**

Create `src/components/ticker/call-timeline.tsx`:

```tsx
import { useRef, useState } from "react";
import { timelineTicks, timelineXPercent } from "#/lib/call-timeline-layout.ts";

export interface TimelineCreator {
  handle: string;
  name: string;
  avatar: string | null;
  calls: { postDate: string; isFirstCall: boolean }[];
}

const ROW_H = 30;

export function TickerCallTimeline({
  creators,
  rangeStart,
  rangeEnd,
}: {
  creators: TimelineCreator[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string>("");

  if (creators.length === 0) return null;

  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  const ticks = timelineTicks(startMs, endMs);

  const onMove = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    setHoverPct(pct);
    const ms = startMs + (pct / 100) * (endMs - startMs);
    setHoverLabel(new Date(ms).toISOString().slice(0, 10));
  };

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className="relative"
        style={{ height: creators.length * ROW_H }}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverPct(null)}
      >
        {/* Hover crosshair across all rows. */}
        {hoverPct !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-foreground/40"
            style={{ left: `${hoverPct}%` }}
          >
            <span className="-translate-x-1/2 absolute -top-5 rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background tabular-nums">
              {hoverLabel}
            </span>
          </div>
        )}

        {creators.map((c, i) => (
          <div
            key={c.handle}
            className="absolute right-0 left-0 flex items-center border-border/30 border-b"
            style={{ top: i * ROW_H, height: ROW_H }}
          >
            {c.calls.map((call, j) => {
              const pct = timelineXPercent(Date.parse(call.postDate), startMs, endMs);
              return (
                <span
                  key={j}
                  title={`${c.name} · ${call.postDate}`}
                  className={
                    call.isFirstCall
                      ? "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2.5 rounded-full bg-foreground ring-2 ring-background"
                      : "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2 rounded-full border border-foreground/60 bg-background"
                  }
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Axis labels. */}
      <div className="relative mt-1 h-4">
        {ticks.map((t) => (
          <span
            key={t.pct}
            className="-translate-x-1/2 absolute font-mono text-[10px] text-muted-foreground tabular-nums"
            style={{ left: `${t.pct}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors referencing `call-timeline.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/components/ticker/call-timeline.tsx
git commit -m "feat(ticker): TickerCallTimeline swimlane with hover crosshair"
```

---

## Task 6: New page route `/t/$symbol/$creator` + `/t/$symbol` redirect

**Files:**
- Create: `src/routes/t.$symbol.$creator.tsx`
- Create: `src/routes/t.$symbol.index.tsx`
- Delete: `src/routes/t.$symbol.tsx`

**Interfaces:**
- Consumes: `fetchDataset`, `fetchPrices`, `fetchCallsIndex`, `listCreators` (`../lib/data`); `summarizeTicker` (`../lib/call-filter`); `CreatorSwitcher` (Task 4); `TickerCallTimeline`, `TimelineCreator` (Task 5); `SwitcherCreator` (Task 2); chart pieces from `c.$handle.ticker.$symbol.tsx` (moved verbatim).
- Produces: the routes `/t/$symbol/$creator` and `/t/$symbol`.

This task **moves** the chart/price/headline machinery out of `c.$handle.ticker.$symbol.tsx` (read it in full first — it is the source) and merges in the cross-creator table + switcher + timeline.

- [ ] **Step 1: Delete the old `/t/$symbol` route file**

```bash
git rm src/routes/t.$symbol.tsx
```

- [ ] **Step 2: Create the exact-match redirect `t.$symbol.index.tsx`**

Create `src/routes/t.$symbol.index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

// Exact /t/$symbol → cross-creator view. Index route (sibling of $creator) so
// this redirect does NOT cascade onto /t/$symbol/$creator the way a parent
// layout's beforeLoad would.
export const Route = createFileRoute("/t/$symbol/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/t/$symbol/$creator",
      params: { symbol: params.symbol.toUpperCase(), creator: "all" },
      replace: true,
    });
  },
});
```

- [ ] **Step 3: Create the page route `t.$symbol.$creator.tsx`**

Create `src/routes/t.$symbol.$creator.tsx` with the full content below. (The chart helpers — `PriceReadout`, `pct`, `signed`, `priceFmt`, `signedCurrency`, `toneClass`, `ChartSkeleton`, `firstDateOf`, the lazy chart imports, and the chart `view`/`query` machinery — are moved verbatim from `c.$handle.ticker.$symbol.tsx`; reproduce them exactly.)

```tsx
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { prefetchHalal, useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { HalalCardContent } from "#/components/halal/halal-card-content.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow, { type Format, NumberFlowGroup } from "@number-flow/react";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready.ts";
import { fetchCallsIndex, fetchDataset, fetchPrices, listCreators } from "../lib/data";
import { summarizeTicker } from "../lib/call-filter";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import type { Call } from "#/lib/types.ts";
import type { ChartMarker } from "#/components/charts/markers/index.ts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table.tsx";
import { ChartBoundary } from "../components/ChartBoundary";
import { TimeframeTabs } from "#/components/TimeframeTabs.tsx";
import type { Timeframe } from "#/lib/window-series.ts";
import { chartQuery } from "#/lib/chart-query.ts";
import { buildChartView } from "#/lib/chart-view.ts";
import { headlineReadout } from "#/lib/headline-readout.ts";
import type { LiveBar } from "#/lib/chart-fetch.ts";
import { siteUrl } from "#/og/site.ts";
import { ogRev } from "#/og/og-rev.ts";
import { CreatorSwitcher } from "#/components/ticker/creator-switcher.tsx";
import { TickerCallTimeline, type TimelineCreator } from "#/components/ticker/call-timeline.tsx";
import type { SwitcherCreator } from "#/lib/ticker-switcher.ts";

const PriceCandles = lazy(() =>
  import("#/components/charts/ticker-charts.tsx").then((m) => ({ default: m.PriceCandles })),
);
const StockVsSpyLine = lazy(() =>
  import("#/components/charts/ticker-charts.tsx").then((m) => ({ default: m.StockVsSpyLine })),
);

function pct(x: number | null) { return x == null ? "—" : `${(x * 100).toFixed(1)}%`; }
function signed(x: number | null) { return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`; }
function priceFmt(x: number | null) {
  if (x == null) return "—";
  const d = x >= 1 ? 2 : 4;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function signedCurrency(x: number | null) {
  if (x == null) return "—";
  const d = Math.abs(x) >= 1 ? 2 : 4;
  const s = x > 0 ? "+" : x < 0 ? "-" : "";
  return `${s}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function toneClass(x: number | null) {
  if (x == null) return "text-muted-foreground";
  return x > 0 ? "text-emerald-600 dark:text-emerald-400" : x < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
}
function ChartSkeleton() { return <div className="h-[320px] w-full animate-pulse rounded-xl bg-muted/40" />; }

export const Route = createFileRoute("/t/$symbol/$creator")({
  loaderDeps: ({ params }) => ({ creator: params.creator }),
  loader: async ({ params, context }) => {
    const symbol = params.symbol.toUpperCase();
    const creatorParam = params.creator;

    const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
    const summary = summarizeTicker(calls, symbol);
    if (summary.callCount === 0) throw notFound();

    // Cross-creator call dates (timeline + all-mode markers).
    const hits = calls
      .filter((r) => r.ticker.toUpperCase() === symbol)
      .map((r) => ({ handle: r.handle, postDate: r.postDate, isFirstCall: r.isFirstCall }));
    const firstDate = hits.reduce((m, h) => (h.postDate < m ? h.postDate : m), hits[0]?.postDate ?? new Date().toISOString().slice(0, 10));

    // Names + avatars for the creators who called this symbol only.
    const shown = new Set(summary.byCreator.map((b) => b.handle));
    const roster = creators.filter((c) => shown.has(c.handle));
    const names = Object.fromEntries(roster.map((c) => [c.handle, c.name] as const));
    const avatars = Object.fromEntries(roster.map((c) => [c.handle, c.avatar] as const));

    // Selected creator: valid only if it actually called this symbol; else All.
    const creatorHandle = creatorParam !== "all" && shown.has(creatorParam) ? creatorParam : null;

    let creatorCalls: Call[] = [];
    if (creatorHandle) {
      try {
        const ds = await fetchDataset(creatorHandle);
        creatorCalls = ds.calls.filter((c) => c.ticker === symbol);
      } catch (err) {
        console.warn(`[ticker loader] dataset fetch failed for ${creatorHandle}, degrading to All:`, (err as Error)?.message ?? err);
      }
    }

    const [, bakedOhlc, bakedSpy] = await Promise.all([
      context.queryClient.ensureQueryData(chartQuery(symbol, "1Y", firstDate)).catch((err) => {
        console.warn("[ticker loader] live-Yahoo prefetch failed, using baked fallback:", (err as Error)?.message ?? err);
        return undefined;
      }),
      fetchPrices(symbol),
      fetchPrices("SPY"),
      prefetchHalal(context.queryClient, [symbol]),
    ]);

    // OG (computed here — head() has no access to derived state).
    const ogImg = creatorHandle
      ? siteUrl(`/api/og/t/${creatorHandle}/${symbol}/${ogRev([creatorCalls[0]?.returns?.["3m"]?.excess ?? null, bakedOhlc.length, Math.round(bakedOhlc.at(-1)?.c ?? 0)])}`)
      : siteUrl("/og.png");
    const ogTitle = creatorHandle
      ? `${symbol} — ${names[creatorHandle] ?? creatorHandle} · Signal Tracker`
      : `${symbol} — who called it · Signal Tracker`;

    return {
      symbol, company: summary.company, summary, names, avatars, hits,
      creatorHandle, creatorCalls, firstDate, bakedOhlc, bakedSpy,
      og: { img: ogImg, title: ogTitle },
    };
  },
  head: ({ params, loaderData }) => {
    const symbol = params.symbol.toUpperCase();
    const creator = params.creator === "all" ? "all" : (loaderData?.creatorHandle ?? "all");
    return {
      meta: [
        { title: loaderData?.og.title ?? `${symbol} · Signal Tracker` },
        { property: "og:title", content: loaderData?.og.title ?? symbol },
        { property: "og:url", content: siteUrl(`/t/${symbol}/${creator}`) },
        { property: "og:image", content: loaderData?.og.img ?? siteUrl("/og.png") },
        { name: "twitter:image", content: loaderData?.og.img ?? siteUrl("/og.png") },
      ],
    };
  },
  component: TickerPage,
});

function PriceReadout({ lastClose, tfChange, tfDelta, usingFallback }: {
  lastClose: number | null; tfChange: number | null; tfDelta: number | null; usingFallback: boolean;
}) {
  const ready = useNumberFlowReady();
  if (lastClose == null) return null;
  const priceFormat: Format = { style: "currency", currency: "USD", minimumFractionDigits: lastClose >= 1 ? 2 : 4, maximumFractionDigits: lastClose >= 1 ? 2 : 4 };
  const deltaFormat: Format = { style: "currency", currency: "USD", signDisplay: "exceptZero", minimumFractionDigits: lastClose >= 1 ? 2 : 4, maximumFractionDigits: lastClose >= 1 ? 2 : 4 };
  const changeFormat: Format = { style: "percent", signDisplay: "exceptZero", minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return (
    <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <NumberFlowGroup>
        <span className="font-heading text-2xl tabular-nums">
          {ready ? <NumberFlow format={priceFormat} value={lastClose} willChange /> : priceFmt(lastClose)}
        </span>
        <span className={`font-mono text-sm tabular-nums ${toneClass(tfChange)}`}>
          {tfChange == null || tfDelta == null ? "—" : ready ? (
            <><NumberFlow format={deltaFormat} value={tfDelta} willChange />{" ("}<NumberFlow format={changeFormat} value={tfChange} willChange />{")"}</>
          ) : `${signedCurrency(tfDelta)} (${signed(tfChange)})`}
        </span>
      </NumberFlowGroup>
      {usingFallback ? <span className="font-mono text-[10px] text-amber-600 uppercase tracking-[0.3em] dark:text-amber-400">· cached daily data</span> : null}
    </div>
  );
}

function TickerPage() {
  const data = Route.useLoaderData();
  const { symbol, summary, names, avatars, hits, creatorHandle, creatorCalls, firstDate, bakedOhlc, bakedSpy } = data;
  const getHalal = useHalalStatus([symbol]);
  const halal = getHalal(symbol);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const { impact, select } = useHaptics();
  const queryClient = useQueryClient();
  const numberFlowReady = useNumberFlowReady();
  const [hoverClose, setHoverClose] = useState<number | null>(null);

  const query = useQuery(chartQuery(symbol, timeframe, firstDate));

  const buildView = (live: typeof query.data | null) =>
    buildChartView({ timeframe, live: live ?? null, bakedOhlc, bakedSpy });
  const liveNow = query.data != null && !query.isPlaceholderData && query.data.ohlc.length > 0 ? query.data : null;
  const [view, setView] = useState(() => buildView(liveNow));

  useEffect(() => {
    if (query.isPending || query.isPlaceholderData) return;
    const live = query.data && query.data.ohlc.length > 0 ? query.data : null;
    setView(buildView(live));
  }, [query.isPending, query.isPlaceholderData, query.data, timeframe, bakedOhlc, bakedSpy]);

  useEffect(() => { setHoverClose(null); }, [view.timeframe]);

  const prefetchTimeframe = (tf: Timeframe) => { queryClient.prefetchQuery(chartQuery(symbol, tf, firstDate)); };

  const usingFallback = view.usingFallback;
  const ohlc: LiveBar[] = view.ohlc;
  const spy: LiveBar[] = view.spy;

  // Markers: selected creator's calls (clickable → proof) or all-mode call
  // dates (non-clickable, cross-creator).
  const callMarkers: ChartMarker[] = useMemo(() => {
    if (creatorHandle) {
      return creatorCalls.map((c) => ({
        date: new Date(c.postDate),
        icon: "▲",
        title: `${symbol} · ${c.postDate}`,
        description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
        onClick: () => { select(); setSelectedCall(c); },
      }));
    }
    return hits.map((h) => ({
      date: new Date(h.postDate),
      icon: "▲",
      title: `${names[h.handle] ?? h.handle} · ${h.postDate}`,
      description: "",
    }));
  }, [creatorHandle, creatorCalls, hits, names, symbol, select]);

  const candles = useMemo(() => ohlc.map((b) => ({ date: new Date(b.date), open: b.o, high: b.h, low: b.l, close: b.c })), [ohlc]);
  const norm = useMemo(() => {
    const base = ohlc[0]?.c ?? 1;
    const spyBase = spy[0]?.c ?? 1;
    const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
    return ohlc.map((b) => ({ date: new Date(b.date), stock: (b.c / base) * 100, spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null }));
  }, [ohlc, spy]);

  const showSkeleton = ohlc.length === 0;
  const lastClose = ohlc.length ? ohlc[ohlc.length - 1].c : null;
  const firstClose = ohlc.length ? ohlc[0].c : null;
  const head = headlineReadout(hoverClose, firstClose, lastClose);

  // Switcher + timeline data from the cross-creator summary.
  const switcherCreators: SwitcherCreator[] = summary.byCreator.map((b) => ({
    handle: b.handle, name: names[b.handle] ?? b.handle, avatar: avatars[b.handle] ?? null,
    lastCallDate: b.lastCallDate, callCount: b.callCount,
  }));
  const timelineCreators: TimelineCreator[] = summary.byCreator.map((b) => ({
    handle: b.handle, name: names[b.handle] ?? b.handle, avatar: avatars[b.handle] ?? null,
    calls: hits.filter((h) => h.handle === b.handle).map((h) => ({ postDate: h.postDate, isFirstCall: h.isFirstCall })),
  }));
  const today = new Date().toISOString().slice(0, 10);

  const callsLabel = numberFlowReady ? (
    <NumberFlow value={summary.callCount} suffix={summary.callCount === 1 ? " call" : " calls"} willChange />
  ) : `${summary.callCount} ${summary.callCount === 1 ? "call" : "calls"}`;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Ticker{creatorHandle ? ` · @${creatorHandle}` : " · all creators"}
          </div>
          <h1 className="mt-1 flex items-center gap-2 font-heading text-2xl">
            {symbol}
            <HalalIndicator info={halal} />
            <span className="text-base text-muted-foreground">{data.company}</span>
          </h1>
        </div>
        <CreatorSwitcher symbol={symbol} creators={switcherCreators} selected={creatorHandle} />
      </header>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col items-start gap-1 sm:w-auto">
            <div className="flex w-full items-start justify-between gap-3 sm:w-auto sm:justify-start">
              <PriceReadout lastClose={head.close} tfChange={head.change} tfDelta={head.delta} usingFallback={usingFallback} />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em] sm:hidden">{callsLabel}</span>
            </div>
            <span className="hidden font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em] sm:block">{callsLabel}</span>
          </div>
          <TimeframeTabs value={timeframe} onChange={(tf) => { impact(); setTimeframe(tf); }} onPrefetch={prefetchTimeframe} />
        </div>
        <div className="relative">
          {showSkeleton ? <ChartSkeleton /> : candles.length === 0 ? (
            <div role="status" aria-live="polite" className="flex h-[320px] w-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">No price data for this symbol.</div>
          ) : (
            <ChartBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <PriceCandles candles={candles} markers={callMarkers} timeframe={view.timeframe} onHoverClose={setHoverClose} />
              </Suspense>
            </ChartBoundary>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">Stock vs SPY · rebased to 100 · markers are call dates</div>
        {showSkeleton ? <ChartSkeleton /> : norm.length === 0 ? (
          <div role="status" aria-live="polite" className="flex h-[320px] w-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">No price data for this symbol.</div>
        ) : (
          <ChartBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <StockVsSpyLine norm={norm} markers={callMarkers} timeframe={view.timeframe} />
            </Suspense>
          </ChartBoundary>
        )}
      </section>

      {halal.status !== "unknown" && (
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-4">
          <HalalCardContent info={halal} />
        </section>
      )}

      {/* Who called it & when. */}
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5">
          <span>Creator</span>
          <span className="hidden text-right md:block">First call</span>
          <span className="text-right">Excess 3m</span>
          <span className="text-right">Excess→now</span>
        </div>
        <ul className="divide-y divide-border/40">
          {summary.byCreator.map((b) => (
            <li key={b.handle}>
              <Link
                to="/t/$symbol/$creator"
                params={{ symbol, creator: b.handle }}
                aria-current={creatorHandle === b.handle ? "true" : undefined}
                className={`grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-4 no-underline transition-colors hover:bg-foreground/[0.03] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5 ${creatorHandle === b.handle ? "bg-foreground/[0.04]" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {avatars[b.handle] ? (
                    <img src={avatars[b.handle]} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border/60" />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-[10px] uppercase ring-1 ring-border/60">{b.handle.slice(0, 2)}</div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-sm text-foreground">{names[b.handle] ?? b.handle}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{b.callCount} call{b.callCount === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">{b.firstCallDate?.slice(0, 7) ?? "—"}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${toneClass(b.ex3m)}`}>{signed(b.ex3m)}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${toneClass(b.exToDate)}`}>{signed(b.exToDate)}</div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-border/40 border-t px-4 py-4 md:px-5">
          <div className="mb-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">Call timeline · ★ = first call · hover to compare</div>
          <TickerCallTimeline creators={timelineCreators} rangeStart={firstDate} rangeEnd={today} />
        </div>
      </section>

      {/* Detail table only when a specific creator is selected. */}
      {creatorHandle && (
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
          <div className="border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">{names[creatorHandle] ?? creatorHandle} · forward return vs SPY · tap a row for proof</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">1w</TableHead>
                <TableHead className="text-right">1m</TableHead>
                <TableHead className="text-right">3m</TableHead>
                <TableHead className="text-right">To date</TableHead>
                <TableHead>Quote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creatorCalls.map((c) => (
                <TableRow key={c.shortcode} onClick={() => { select(); setSelectedCall(c); }} className="cursor-pointer">
                  <TableCell className="font-mono tabular-nums">{c.postDate}{c.isFirstCall ? " ★" : ""}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1w"].excess)}`}>{pct(c.returns["1w"].excess)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1m"].excess)}`}>{pct(c.returns["1m"].excess)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["3m"].excess)}`}>{pct(c.returns["3m"].excess)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["toDate"].excess)}`}>{pct(c.returns["toDate"].excess)}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{c.quote}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <ProofViewer call={selectedCall} handle={creatorHandle ?? ""} onClose={() => setSelectedCall(null)} />
    </main>
  );
}
```

- [ ] **Step 4: Regenerate the route tree + typecheck**

Run: `bunx tsc --noEmit`
(The TanStack vite plugin regenerates `src/routeTree.gen.ts` on `bun run dev`/build; if `tsc` complains that `/t/$symbol/$creator` is not a known route, start `bun run dev` briefly to regenerate the tree, stop it, then re-run `tsc`.)
Expected: PASS — no type errors. Confirm `Route.useLoaderData()` types resolve and the `Link`/`navigate` `to="/t/$symbol/$creator"` targets are recognized.

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS (DB-gated tests skip without env; everything else green).

- [ ] **Step 6: Commit**

```bash
git add src/routes/t.$symbol.$creator.tsx src/routes/t.$symbol.index.tsx src/routeTree.gen.ts
git commit -m "feat(ticker): ticker-primary page at /t/\$symbol/\$creator + /t/\$symbol redirect"
```

---

## Task 7: Redirect old `/c/$handle/ticker/$symbol` + update internal links + final verification

**Files:**
- Modify: `src/routes/c.$handle.ticker.$symbol.tsx` (replace entire body with a redirect)
- Modify: `src/routes/c.$handle.index.tsx` (~line 440)
- Modify: `src/routes/explore.tsx` (~line 122)

**Interfaces:**
- Consumes: the `/t/$symbol/$creator` route (Task 6).

- [ ] **Step 1: Replace the old creator-ticker route with a redirect**

Replace the **entire** contents of `src/routes/c.$handle.ticker.$symbol.tsx` with:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy per-creator ticker URL → ticker-primary page with the creator selected.
// This route is a leaf (no children), so the beforeLoad redirect is safe.
export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/t/$symbol/$creator",
      params: { symbol: params.symbol.toUpperCase(), creator: params.handle },
      replace: true,
    });
  },
});
```

- [ ] **Step 2: Update the creator-page Link**

In `src/routes/c.$handle.index.tsx` around line 440, change the call-row link target. Find:

```tsx
        to="/c/$handle/ticker/$symbol"
```

The surrounding `<Link>` currently passes `params={{ handle, symbol: ... }}`. Change the `to` and `params` so it targets the new route with the creator preselected:

```tsx
        to="/t/$symbol/$creator"
```

and update its `params` prop from `{ handle, symbol: <sym> }` to `{ symbol: <sym>, creator: handle }` (keep whatever expression currently supplies the symbol; only rename `handle`→`creator` and drop the standalone `handle` key). Read lines ~430–450 to apply precisely.

- [ ] **Step 3: Update the explore Link**

In `src/routes/explore.tsx` line ~122, change:

```tsx
<Link to="/t/$symbol" params={{ symbol: r.ticker }} className="font-medium text-sm text-foreground no-underline hover:underline">{r.ticker}</Link>
```

to target the All view directly (avoids a redirect hop):

```tsx
<Link to="/t/$symbol/$creator" params={{ symbol: r.ticker, creator: "all" }} className="font-medium text-sm text-foreground no-underline hover:underline">{r.ticker}</Link>
```

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -rn 'to="/t/\$symbol"\|to="/c/\$handle/ticker' src/routes src/components`
Expected: **no matches** (every internal link now targets `/t/$symbol/$creator`). The only remaining `/c/$handle/ticker/$symbol` string should be the `createFileRoute(...)` id in the redirect file.

- [ ] **Step 5: Typecheck + tests + build**

Run: `bunx tsc --noEmit && bun test && bun run build`
Expected: all PASS. The build regenerates `routeTree.gen.ts` and emits the Vercel output without route-resolution errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/c.$handle.ticker.$symbol.tsx src/routes/c.$handle.index.tsx src/routes/explore.tsx src/routeTree.gen.ts
git commit -m "feat(ticker): redirect legacy /c/.../ticker/... and repoint internal links"
```

---

## Final verification (before merge to `main`)

Per the project workflow, build/typecheck/test run in this worktree; **visual verification happens on `main` after merge**. After merging, on the `main` dev server confirm:

- `/t/NOW/all` renders: header with `Ticker · all creators`, switcher (All active), both charts with all-creator markers, who-called table + timeline (hover crosshair lines up across rows), **no** detail table.
- `/t/NOW/kevvonz` renders: switcher (kevvonz avatar active + pinned first), creator markers (clickable → ProofViewer), detail table present. Switching All↔creator and creator↔creator does **not** replay the chart entrance (component stays mounted).
- Search tab morphs: pill expands to full width, combobox input appears, filtering works, selecting navigates.
- Redirects: visiting `/t/NOW` lands on `/t/NOW/all`; visiting `/c/kevvonz/ticker/NOW` lands on `/t/NOW/kevvonz`.
- Tooltips on avatar tabs show creator names; tab triggers show no name text.
- Single-caller ticker: switcher is absent.

---

## Self-Review (completed)

- **Spec coverage:** path-param route (T6), `all` sentinel + redirects (T6/T7), creator-as-selection markers/detail (T6), switcher avatars+tooltips+morph combobox (T4), who-called table + timeline (T5/T6), `lastCallDate` (T1), OG-in-loader + `$rev` (T6), uppercase symbol (T1-style in T6/T7), non-caller fallback-to-All (T6 loader), `firstDate` cross-creator (T6). Sitemap = explicitly out-of-scope per spec.
- **Placeholder scan:** none — every code step has complete content. The two link edits (T7 S2/S3) reference exact current strings to find.
- **Type consistency:** `SwitcherCreator` (T2) reused verbatim in T4/T6; `TimelineCreator` (T5) built in T6; `lastCallDate` (T1) consumed in T2/T6; loader return shape matches `Route.useLoaderData()` destructure in T6.
