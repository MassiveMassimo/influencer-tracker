# Trait Badges — design spec (2026-07-08)

## Problem

`gradeFor` (`src/lib/grade.ts`) reduces a creator to one letter + one persona picked by a
flat switch. The dataset carries several orthogonal behavioral signals (conviction
calibration, ticker concentration behavior, return skew, market-regime dependence,
career trajectory) that the single-label tree computes nothing from, or would have to
discard. Deepening the persona switch multiplies branches and still surfaces one fact.

## Decision

Two-layer identity: keep the archetype persona exactly as-is, add an independent layer
of **trait badges** — 0–N boolean traits earned separately, each a pure predicate over
the same `(Scorecard, Call[])` inputs `gradeFor` already receives. Computed client-side;
no pipeline, dataset, or DB change.

## v1 trait set

All predicates run over scored first-calls (`isFirstCall`, non-null 3m excess unless
stated). Every trait has its own N-guard; below guard it never fires. Thresholds are
starting points to be tuned against the live roster before ship, same as `K` and the
bands in grade.ts.

| id | Name | Predicate | Guard |
|---|---|---|---|
| `laser-eyes` | Laser Eyes | crypto share of calls > 60% (ticker ends `-USD`) | n ≥ 10 |
| `martingale` | The Martingale | ≥ 3 re-pitch events: a non-first call on a ticker whose most recent prior call is underwater (3m excess < 0; toDate fallback if 3m null) | ≥ 3 events |
| `lottery-ticket` | Lottery Ticket | Fisher-Pearson skewness of 3m excess > 1 AND median 3m excess < 0 | n ≥ 20 |
| `bull-only` | Bull Market Only | split calls by sign of `returns["3m"].spy`: hit(SPY-up) − hit(SPY-down) ≥ 0.30 AND hit(SPY-down) < 0.5 | ≥ 8 calls per regime |
| `rising-star` / `fallen-star` | Rising Star / Fallen Star | order by postDate, split halves: mean 3m excess delta ≥ +0.08 → rising; ≤ −0.08 → fallen | n ≥ 30 |
| `calibrated` / `confidently-wrong` | Calibrated / Confidently Wrong | Pearson corr(conviction, 3m excess) ≥ +0.3 → calibrated; ≤ −0.3 → confidently wrong | n ≥ 30 AND stdev(conviction) > 0.05 |

Dual-direction rows are one predicate with two variants — at most one variant fires.
Max simultaneous traits: 6.

Deliberately deferred to v2 (needs pipeline data): pre-call momentum (real FOMO
measurement — needs pre-postDate prices; `spark` starts at postDate), cross-creator
consensus (needs calls-index join at score time), cadence burstiness (weak signal,
hard to explain).

## Data layer

`src/lib/traits.ts`:

```ts
export interface Trait {
  id: string;
  name: string;
  blurb: string;      // one playful line, PERSONA_BLURB voice
  hue: string;        // tailwind hue token, drives gradient + icon color
  shape: "hexagon" | "triangle-down" | "ticket" | "shield" | "star" | "rosette";
  icon: string;       // iconify class, e.g. "icon-[mdi--fire]"
}

export function traitsFor(calls: Call[]): Trait[];
```

(No v1 trait reads the Scorecard — all signals derive from `Call[]` — so the
signature takes only `calls`.)

Flat array of `{ ...meta, test(ctx): boolean }` entries; `traitsFor` builds the ctx once
(scored first-calls, ordered-by-date excess series, SPY-regime split, conviction pairs)
and filters. Adding a trait = adding an entry; the persona tree is never touched.
Returned array is pre-sorted by the display priority below.

Priority (most informative first): calibrated/confidently-wrong → bull-only →
rising/fallen-star → martingale → lottery-ticket → laser-eyes.

## UI

`src/components/trait-badges.tsx`, rendered on the creator overview
(`src/routes/c.$handle.index.tsx`) in the grade medallion block:

- **Desktop:** badge row immediately left of the `GradeMedallion`.
- **Mobile:** wraps below the medallion.
- **Cap:** 3 visible + a "+N" overflow chip; overflow chip's popover lists the rest.

Each badge (~28–32 px):

- **Own SVG silhouette per trait** (user decision — shape variety over uniform pill):
  hexagon (laser-eyes), inverted triangle (martingale), ticket stub (lottery-ticket),
  shield (bull-only), star (rising/fallen-star), rosette/award-seal
  (calibrated/confidently-wrong). Ticket stub uses the user-supplied side-notched
  24×24 path (notches at the horizontal midpoints), scaled to badge size.
- **Subtle same-hue gradient fill** (`from-{hue}-500/15 to-{hue}-500/5` direction),
  **filled icon** centered, colored darker same hue (`text-{hue}-600
  dark:text-{hue}-400`).
- **Icons from one consistent filled set** via the existing Iconify Tailwind plugin
  (`icon-[mdi--*]` / `game-icons` for the bull) — no mixing lucide strokes with filled
  glyphs inside the badge row. Exact slugs picked at implementation with a visual pass.
- **Hues:** laser-eyes orange, martingale red, lottery-ticket violet, bull-only amber,
  rising-star emerald, fallen-star rose, calibrated teal, confidently-wrong fuchsia.
- **Hover/tap** opens a coss `preview-card` popover with name + blurb — same pattern
  and propagation-stopping as `HalalIndicator` (badges may sit inside linked contexts).
- Honors `prefers-reduced-motion` for any hover transition; a11y label = trait name.

## Error handling / edge cases

- No traits earned → component renders nothing (no empty container shifting the
  medallion).
- `gradeFor` returns null (below `LOW_CONFIDENCE_N`) → traits still computed
  independently; guards make most impossible at that size anyway. Simplest rule:
  render badges only when the medallion renders.
- All predicates null-safe: horizon excesses can be null; filter before math; empty
  regime split or zero conviction variance → trait silently not earned.

## Stability

Threshold traits near a boundary can flap on daily re-score. Accepted for v1;
guards' minimum-N and wide margins reduce it. Hysteresis only if flapping proves
annoying in practice.

## Testing

`src/lib/traits.test.ts` (bun test): synthetic `Call[]` fixtures per trait — earns /
misses-by-threshold / misses-by-guard, plus both variants of the dual-direction pairs
and null-excess robustness. Statistical helpers (skewness, Pearson r) unit-tested
directly. UI verified visually on `main` post-merge per the project's worktree flow.

## Out of scope

Explore-row badges, ticker-page badges, badge history/timeline, hysteresis,
v2 pipeline-backed traits (momentum, consensus).
