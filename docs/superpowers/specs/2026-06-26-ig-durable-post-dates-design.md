# Durable IG post-date store — design

**Date:** 2026-06-26
**Status:** design (approved approach + Opus review folded in, pre-plan)

## Problem

IG `extract` (`pipeline/extract.ts`) resolves each reel's post date *only* from
`raw/<code>/*.info.json` (yt-dlp metadata): `postDateOf` returns `null` when the
info.json is absent, and the caller skips that reel (`skip <code>: no upload_date
in info.json`). But `raw/` is disposable — the documented cleanup purges it to free
GBs, and a caught-up **forward** scrape downloads nothing new — so on a normal daily
run there is no info.json for already-harvested reels. Every reel is skipped →
`extract` emits 0 calls → `guard-no-shrink` correctly refuses to publish (it is
below the committed baseline).

This was found by the live IG-ingest canary on `roadto100kportfolio` (2026-06-26):
proxy egress OK, burner session alive, forward-scroll caught-up correctly, then
`extract` skipped all 269 transcripts (`scored 0 << baseline 244; refusing sync`).
No data was corrupted — the guard blocked before `score` ran — but the automation
cannot produce fresh IG data until post dates are durable.

The dates *exist* at scrape time: `scrape.ts` harvests `seen = Map<shortcode,
taken_at_ms>` from intercepted GraphQL (`scrape.ts:119,126`). They are simply
thrown away — `scrape.ts:184-186` persists only the bare shortcode list to
`raw/shortcodes.json` and delegates date storage to the disposable info.json.

X does not have this bug: its dates ride durable artifacts. IG's only durable
per-reel artifact is the transcript, which carries no date.

## Goal

Make IG post dates durable so a daily re-extract reproduces every reel's anchor
date with no dependence on `raw/`, while preserving the project's frozen-scoring
guarantee (a scored reel's anchor date never silently changes between runs).

## Approach (chosen)

Persist the GraphQL dates `scrape()` already harvests into a **committed,
accumulating** per-creator store, and make the durable store the **source of
truth** for `extract`.

### Components

| Unit | What it does |
|---|---|
| `pipeline/post-dates.ts` (new) | The store + pure helpers. Path `data/creators/<h>/post-dates.json` = `{ "<shortcode>": "YYYY-MM-DD" }`. Exports `loadPostDates(handle): Promise<Record<string,string>>`, `mergePostDates(existing, incoming): Record<string,string>` (**existing-wins** on key collision), `savePostDates(handle, map): Promise<void>` (atomic temp-then-rename), `formatTakenAt(ms: number): string \| null` (UTC `YYYY-MM-DD`, `null` for falsy/non-positive ms). |
| `pipeline/scrape.ts` (edit) | After the scroll, build `{code → formatTakenAt(taken_at_ms)}` for every `seen` entry with a positive `taken_at`, `mergePostDates` it onto the loaded store, `savePostDates`. The existing `raw/shortcodes.json` write is left untouched. This is the **primary writer** — it populates the store for every reel the scrape sees, new reels included. |
| `pipeline/extract.ts` (edit) | `postDateOf` reads the **store first**; only if the shortcode is absent does it fall back to `info.json`. After the worker pool finishes, any date resolved from `info.json` (i.e. not already in the store) is merged back into the store (existing-wins) and saved, so an info.json-sourced anchor is frozen for all future runs. Skip the reel only when both sources miss. |
| `scripts/backfill-post-dates.ts` (new, one-time) | Seed the store for existing IG creators from their committed `dataset.json` postDates (dedup by shortcode). Idempotent (existing-wins merge). Detects IG creators by **non-numeric shortcodes** (reuse `majorityNumeric` from `scripts/shortcodes.ts`) rather than a hardcoded handle list. |
| `.gitignore` (edit) | Add `!data/creators/*/post-dates.json` *after* the `data/creators/*/*` ignore line so the store is **committed** and survives the VM's `git checkout -- data/` + `git clean -fd data/` + the `raw/` purge. |

`prices.ts`, `score.ts`, `guard-no-shrink.ts`, `calls.ts`, `transcribe.ts`,
`frames.ts`, `run.ts` are unchanged.

## Data flow

```
scrape (forward or full)
  harvest seen = Map<shortcode, taken_at_ms> from GraphQL   [dates available here]
  store = loadPostDates(handle)
  incoming = { code: formatTakenAt(ms) for (code,ms) in seen if ms > 0 }
  savePostDates(handle, mergePostDates(store, incoming))    [existing-wins, committed]
  → reels downloaded (yt-dlp) only for NEW reels; raw/ may be purged later

extract  (rebuilds reel-calls.json over ALL transcripts)
  store = loadPostDates(handle)
  per reel code:
    postDate = store[code] ?? formatUploadDate(info.json upload_date) ?? null
    if null: skip (no anchor; never fabricate)
    else classify → toReelCalls(c, code, postDate)
  merge any info.json-sourced dates back into store (existing-wins), save
  PAUSE (run.ts)

resume: guard-no-shrink → prices + score   (unchanged; anchor now reproducible)
```

## Why this is reproducible (the Opus-review fix)

The durable store **wins** over `info.json`. A reel's anchor is therefore
independent of whether `raw/` happens to be present on a given run — it is read
from the committed store every time. `info.json` is only a gap-filler for a reel
not yet in the store, and that resolved date is immediately frozen into the store.
This is the entire point: with the earlier "info.json first" precedence, a reel's
anchor would flip between `taken_at`-derived and `upload_date`-derived depending on
`raw/` presence, silently changing its forward returns — exactly the
non-reproducibility the frozen-scoring rule forbids.

## Date-source consistency

- `formatTakenAt` formats the UTC epoch (`taken_at_ms`) in **UTC**
  (`new Date(ms).toISOString().slice(0, 10)`), matching epoch semantics.
- Backfill-seeded dates derive (transitively) from yt-dlp `upload_date`;
  scrape-seeded dates derive from GraphQL `taken_at`. For a reel posted near a
  midnight-UTC boundary the two conventions can differ by ≤1 calendar day.
  **existing-wins** means whichever source committed a date first freezes it, so
  the per-reel anchor is stable forever even if it is ≤1 day off a hypothetical
  re-derivation. Stable-but-possibly-off-by-one is the correct tradeoff over
  correct-but-flipping (a flip would silently restate scored returns).
- `dataset.json` postDate is already `YYYY-MM-DD`, so backfill needs no
  reformatting.

## Error handling

- **No anchor (both sources miss):** skip the reel (existing behavior). It
  contributes 0 calls — the guard compares *scored* counts, so a skipped
  unscored reel never trips it.
- **`taken_at` missing/`0`:** `scrape.ts` stores `(node.taken_at ?? 0) * 1000`;
  `formatTakenAt` returns `null` for non-positive ms, so a 1970 date is never
  written. Such a reel simply has no store entry (and is skipped at extract
  unless an info.json fills it) — acceptable, 0 scored calls.
- **Partial write:** `savePostDates` writes a temp file then renames, so a crash
  mid-write cannot truncate the committed store. A lost temp is recovered by the
  next scrape.
- **Backfill on a creator with no `dataset.json` or unreadable JSON:** skip that
  creator (log), never throw.

## Guard / scoring impact

`guard-no-shrink` compares `dataset.calls.length` (scored bullish-buy, priceable)
against the freshly-scored reel-calls. Backfill seeds the store from
`dataset.json`, which **is** the scored set, so every previously-scored shortcode
gets an anchor and re-extract reproduces it (modulo legitimate re-classification —
see Risks). Transcript-only/unscored reels stay skipped but contribute 0 scored
calls, so the count is unaffected.

## Testing

- `formatTakenAt`: UTC formatting of a known epoch; `null` for `0`/negative/NaN;
  a near-midnight-UTC ms formats to the UTC day.
- `mergePostDates`: existing-wins on collision; adds genuinely-new keys; does not
  mutate inputs.
- `postDateOf` precedence (the core fix): store hit wins even when an info.json
  with a *different* date exists; store miss + info.json present → info.json value;
  both miss → `null`. (fs-backed test under a throwaway handle in `DATA`, cleaned
  up — mirrors `scrape-forward.test.ts`.)
- `backfill-post-dates`: a fixture `dataset.json` with multi-ticker posts (repeated
  shortcodes) yields a deduped `{shortcode: date}` map; idempotent re-run is a
  no-op; a numeric-shortcode (X) creator is not seeded.
- `scrape.ts` / `extract.ts` integration (browser / network) is not unit-tested;
  verified by re-running the VM canary (below).

## Rollout

1. Build + merge to `main` (worktree → `main`, IG-only push as before).
2. On the VM: pull, run `scripts/backfill-post-dates.ts` to seed the 3 IG
   creators' stores, commit the new `post-dates.json` files.
3. Re-run the `roadto100kportfolio` canary under the service env — expect it to
   resolve dates from the store, classify, and either publish a refreshed dataset
   or surface a *legitimate* shrink for operator review (not the 0-call bug).
4. Re-enable + start `influencer-ingest-ig.timer`.

## Risks (flagged, not fixed here)

- **Re-classification drift:** re-extract runs the *current* `CLASSIFY_SYS`. If it
  differs from when each IG `dataset.json` was built, the recovered scored count
  may legitimately differ from baseline — that is the guard working as intended
  (operator reconciles via the call-deletion runbook), not this fix's concern.

## Out of scope

- A full re-scrape to obtain a *complete* (all-reels, not just scored) authoritative
  date map — unnecessary; unscored reels do not affect the guard, and future scrapes
  fill them in via GraphQL.
- Any change to the X path (it has no analogous bug).

## Security

- `post-dates.json` is `{shortcode: "YYYY-MM-DD"}` — public IG reel codes + public
  post dates, both already present in committed `dataset.json`. No PII, no
  credential bytes. The burner `cookies.txt` / `.chrome-profile` are untouched.
