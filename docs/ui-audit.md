# UI Audit — influencer-tracker

**Date:** 2026-06-03
**Scope:** Does the dashboard's data, charts, and metrics actually let a user answer
*"which finfluencers are most accurate at stock calls, and can I trust the numbers?"*
**Method:** Read every route, chart, and the scoring math (`scorecard.ts`, `returns.ts`,
`score.ts`). Ground-truthed against the only live dataset (`kevvonz`, 13 calls).

---

## Verdict

The app is a competent **per-creator performance viewer**, but it does **not** serve its
stated purpose on two counts:

1. **It cannot rank or compare creators.** The product question is "who is *most*
   accurate" — a comparative question — yet there is no leaderboard, no sortable table,
   no side-by-side. The landing page lists creators in arbitrary (`index.json` append)
   order with one unlabeled metric each.
2. **The accuracy numbers it does show are not trustworthy as presented.** Three
   different "beats SPY" figures appear on a single page, none disclosing sample size,
   and the headline metric is computed on n=7.

Both are fixable. Findings below are prioritized P0 (breaks the purpose) → P3 (polish).

---

## P0 — Blocks the stated purpose

### P0-1. No cross-creator ranking exists
- **Where:** `src/routes/index.tsx`, `pipeline/score.ts:60-72` (`updateIndex`).
- **What:** Landing page renders creators in `index.json` order, which is
  insertion/update order (`idx.push(entry)` / in-place update) — **not** sorted by any
  accuracy metric. Each row shows only `avgExcess3m` + call count. No way to sort,
  filter, or compare.
- **Why it matters:** "Most accurate" is inherently comparative. Today the user must
  open each creator, memorize numbers, and rank in their head. With >2 creators this
  collapses.
- **Fix:** A sortable leaderboard on `/` (columns: hit rate, avg excess by horizon,
  n calls, last updated), sortable by each. Carry the needed fields into `index.json`.

### P0-2. Conflicting "beats SPY" numbers on one page, no denominators
- **Where:** Overview page (`c.$handle.index.tsx`): `HitRateGauge`
  (`AnalyticsCharts.tsx:23`) vs `CallFunnel` (`:37`) vs the stat tiles.
- **What (real kevvonz numbers):**
  | Surface | Shows | Actually is | Denominator |
  |---|---|---|---|
  | Hit-rate gauge | **57%** | 4 of 7 | first calls *with 3m elapsed* |
  | Funnel "13 → 4 beat SPY" | reads as **31%** | 4 of 13 | *all* buy calls (incl. repeats + pending) |
  | (unshown) to-date first-call win | **40%** | 4 of 10 | first calls |
- **Why it matters:** A user comparing creators will read whichever number is biggest /
  most prominent. The gauge (57%) and funnel (31%) describe the *same* creator's *same*
  skill and disagree by 26 points purely from denominator choice. This is the single
  most misleading thing in the app.
- **Fix:** Pick one canonical win-rate definition, show it everywhere with its `n`
  (e.g. "57% · 4/7"), and either fix the funnel's last stage to share the funnel's
  denominator or relabel it so it's not read as a win rate.

### P0-3. Headline metrics hide sample size and significance
- **Where:** `Scorecard.tsx:11-12`, `c.$handle.index.tsx:44`, `HitRateGauge`.
- **What:** "Hit rate 3m: 57%" is rendered identically whether it's 4/7 or 400/700.
  kevvonz's is 4/7 — not distinguishable from luck. No `n`, no confidence interval, no
  "needs more data" state.
- **Why it matters:** Ranking creators by point estimates over tiny, unequal samples
  ranks noise. A creator with 1 lucky call (100%) outranks one with 55/100 (55%).
- **Fix:** Always show `n` next to every rate. Gray out / flag rates below a minimum
  sample threshold (e.g. n<10). In the leaderboard, never sort lucky-small above
  proven-large without surfacing `n`.

---

## P1 — Metrics that quietly flatter

### P1-1. First-call-only scoring is invisible and one-directional
- **Where:** `scorecard.ts:5-11` (`dedupeFirstCall`), `:19` (`first = ...isFirstCall`).
- **What:** Only the earliest call per ticker is scored. Re-pumping a ticker as it rises
  (or falls) is free — later calls never count. The `first` badge in the calls list
  (`c.$handle.index.tsx:187`) has no tooltip explaining it removes the call from scoring.
- **Why it matters:** A creator who calls a stock 5× on the way up looks identical to one
  who called it once. Hides whether conviction tracks price (a tell for momentum-chasing).
- **Fix:** Keep first-call as the primary metric (defensible), but (a) explain the badge,
  (b) optionally show a secondary "all calls" win rate so the dedup effect is visible.

### P1-2. Funnel mixes denominators (root cause of P0-2)
- **Where:** `score.ts:27-34`.
- **What:** Stages are: 157 reels → 27 named a stock → **13 explicit buy (all)** →
  **4 beat SPY (first calls only, to-date, excludes pending)**. The last stage silently
  switches population (all→first) *and* time basis (mixed horizons→to-date) *and* drops
  pending. The visual funnel implies a single shrinking population; it isn't one.
- **Fix:** Make the last stage `firstCalls that beat` over `firstCalls` (10), or add a
  "first calls" stage so the narrowing is honest, and exclude or separately mark pending.

### P1-3. "Excess vs SPY" is sold as alpha but isn't risk-adjusted
- **Where:** `returns.ts:43` (`excess = stock - spy`), landing copy "net of SPY"
  (`index.tsx:20`).
- **What:** Excess is raw return minus SPY return — no beta adjustment, no sector/factor
  control. A high-beta stock up 15% while SPY is up 12% scores +3% "excess" even though,
  beta-adjusted, it lagged. Comparisons across creators with different risk profiles, and
  across bull/bear regimes, are not apples-to-apples.
- **Why it matters:** Whoever calls the highest-beta names wins the ranking in an up
  market, regardless of skill.
- **Fix (cheap):** Stop implying alpha — label it "return vs SPY (not risk-adjusted)" and
  add it to the caveats. **(thorough):** beta-adjust excess, or report hit rate (sign of
  excess) as the primary skill metric since it's less beta-sensitive than magnitude.

### P1-4. "3m" metrics are frozen at generation time, presented as live
- **Where:** `returns.ts:24-30` (computed once at `score`), header "as of {generatedAt}"
  (`c.$handle.index.tsx:60`).
- **What:** The "as of" date is shown (good), but the gauge/tiles read as current. If the
  dataset is 2 months stale, "3m hit rate" reflects windows that closed 2 months ago and
  the to-date figures are simply old.
- **Fix:** Surface staleness more loudly when `generatedAt` is old (e.g. "data 47 days
  old"); on the leaderboard, show last-updated per creator so a stale creator isn't
  silently compared to a fresh one.

---

## P2 — Correctness & clarity nits

- **P2-1. Landing ignores the avatar it already has.** `index.json` carries a base64
  `avatar`; `index.tsx:46-48` renders `handle.slice(0,2)` initials instead. Dead data.
- **P2-2. Zero counts as "up/green."** `index.tsx:38` `up = avgExcess3m >= 0`; `CallRow`
  `excess >= 0` → green beat. Exactly-flat shows as a win. Use `> 0` or a neutral state.
- **P2-3. Conviction scatter has no y-axis scale/label.** `AnalyticsCharts.tsx:80-91`
  labels conviction (x) and a 0% line, but the excess (y) axis is unlabeled and
  auto-scaled per-creator, so the same dot height means different returns on different
  pages. Add a y tick (e.g. the `maxAbs` value) and a label.
- **P2-4. Conviction's provenance is undocumented in the UI.** It's an LLM-inferred 0–1
  from the post, not the creator's stated confidence. The scatter invites a
  skill-vs-conviction read with no caption saying the axis is model-estimated.
- **P2-5. `best`/`worst` use a median split, not top/bottom-N.** `scorecard.ts:41-42`
  takes from the top/bottom *halves*. Currently unused by the UI, but it's a latent bug if
  surfaced. Mention, don't fix unless wired up.

## P3 — Polish

- Calls list and ticker table don't link back to the source post from the row affordance
  beyond the proof viewer; fine, but the `first` badge needs a tooltip (see P1-1).
- No empty/low-data state on charts beyond "No elapsed calls yet" — a creator with 1–2
  calls renders confident-looking charts.

---

## Recommended sequence (per your direction: build ranking, push hard, fix as I go)

1. **P0-1 leaderboard** — the feature that makes the app answer its own question.
2. **P0-2 + P0-3 + P1-2** — show `n` everywhere, reconcile the win-rate definitions, fix
   the funnel. These are the trust fixes; cheap and high-impact.
3. **P1-3 / P1-4 labeling** — relabel "excess" honestly, surface staleness.
4. **P2 nits** — avatars, zero-tone, scatter axis, conviction caption.

Items that change the *scoring methodology* (beta-adjustment, all-calls win rate) are
flagged but left as decisions, not silently applied.
