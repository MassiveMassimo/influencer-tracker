# perf — Playwright performance suite

Revisitable performance tests. Re-run anytime; every run prints a metrics table
and writes JSON to `perf/.report/` (gitignored). Budgets are **soft**
(`expect.soft`) and generous — a clean run is green, only a real regression fails.

## Run

```bash
bun run test:perf            # everything (starts both servers)
bun run test:perf:render     # render-churn only (dev build)
bun run test:perf:page       # web-vitals / bundle / jank / memory (prod build)
```

First run builds the prod bundle (slow). Both servers are started by Playwright;
if you already have them up on 3100/3200 they're reused (non-CI).

## Two projects, two builds (intentional)

| Project      | Server                               | What it measures                                                   | Why this build                                     |
| ------------ | ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------- |
| `render-dev` | `vite dev` :3100                     | per-component re-renders on timeframe/creator switch               | dev has React profiling + readable component names |
| `page-prod`  | prod build → nitro node server :3200 | LCP/FCP/CLS/TTFB, JS+total transfer, long tasks, LoAF, heap growth | realistic, minified, profiling off                 |

## Files

- `helpers.ts` — instrumentation (render counter via react-scan pre-mount hook +
  `onCommitFiberRoot`; native `PerformanceObserver` collectors), the interaction
  driver, budgets, and the report sink.
- `render-churn.pw.ts` — render counts per interaction (dev).
- `page-perf.pw.ts` — load metrics per route + interaction-time jank (prod).
- `memory.pw.ts` — heap growth over repeated identical interactions (prod).

Specs are `*.pw.ts` (not `*.spec.ts`) so `bun test` / CI never picks them up.

## Reading the render numbers

The render count is **machine-relative** — the candle morph animates per frame,
so a faster CPU commits more frames and the count rises. Watch two things, not the
absolute number:

1. **Trend on the same machine** — a jump means a new wide re-render path.
2. **The component breakdown** (in the report + console) — a component that has no
   business re-rendering on a chart-timeframe change appearing in the top list is
   the real signal. Baseline top is `AnimatedCandle` / `motion.*` (the morph) — those
   are expected; tooltips / checkboxes / scroll areas climbing the list are not.

## Baseline (2026-06-24, local dev machine)

- render: ~6500 renders/switch, ~10 commits/switch; top = AnimatedCandle, motion.g/rect (morph)
- ticker JS 1026 KB · creator 968 KB · home 674 KB
- LCP <500 ms · CLS: creator 0.067 (stat-tile reveal), others ~0
- heap growth 28.7 MB / 28 switches (likely bounded query cache, not a leak)
