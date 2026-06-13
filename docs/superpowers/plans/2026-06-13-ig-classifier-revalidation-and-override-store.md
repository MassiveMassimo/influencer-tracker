# Plan: IG classifier re-validation + manual-correction override store

Status: proposed (2026-06-13). Trigger: the first end-to-end IG-on-VM run (kevvonz,
162 reels) needed ~7% hand-correction of `isExplicitBuy`, and one hand-flip + one
owner-DELETE to reconcile against a prior Groq-based scoring. The Opus review flagged
both the underlying classifier-quality risk and the fact that manual corrections don't
survive a re-score. Neither is a quick fix; this captures the approach before IG
ingestion scales.

## Workstream A — IG classifier re-validation

**Problem.** The model bake-off that picked `deepseek-v4-flash` (text) + `kimi-k2p5`
(vision) was run on **TheProfInvestor X data** (written posts). IG calls are **Parakeet
transcripts of spoken audio** — a different input distribution (disfluency, filler,
conversational phrasing like "I bought another 46 shares right before making this
video"). On kevvonz the new classifier produced a false-negative on that exact quote
and disagreed with the prior run on a ticker. One creator, ~7% miss rate, first IG
exposure → the bake-off does not demonstrably generalize across modality.

**Goal.** Know IG-specific call-detection precision/recall before trusting unattended
IG ingestion.

**Approach (cheap first).**
1. Build a small labeled IG golden set: ~50–100 reels across ≥2 IG creators, hand-label
   `(ticker, direction, isExplicitBuy)` from transcript+frames. kevvonz's 48 extracted
   calls (now human-reviewed) are a starting seed.
2. Score the current `deepseek-v4-flash` against it → precision/recall on
   `isExplicitBuy && bullish` (the only field that gates scoring). Track separately from
   X metrics.
3. If recall is weak (the observed failure mode — under-flagging explicit buys), test
   alternatives on the IG set: a larger Fireworks model, a prompt tweak to `CLASSIFY_SYS`
   for spoken-transcript cues, or a two-model agree/escalate gate (cf. the
   [[extraction-autonomy-findings]] note — but that found T1×2 self-agreement vacuous, so
   prefer a *diverse* second model, not the same one twice).
4. Decide: keep deepseek-v4-flash, swap, or add an IG-only model override in the provider
   matrix.

**Open questions.** Is transcript quality (Parakeet) part of the miss, or purely the
classifier? (Check the HIMS transcript verbatim.) Do frames/vision hints get fed into the
text classifier, or only ticker resolution?

## Workstream B — manual-correction override store

**Problem.** Hand-editing `isExplicitBuy` on `reel-calls.json` is lost on the next
re-score (the pipeline re-classifies from scratch, and under `USE_DB=1` the
ephemeral-scratch git policy discards `data/` churn). Every human review decision
evaporates. With a ~7% correction rate this is not sustainable.

**Goal.** Human corrections persist across re-runs and are auditable.

**Approach (minimal).**
- A per-creator overrides file (committed, NOT gitignored), e.g.
  `data/creators/<h>/overrides.json`: a list of `{ shortcode, ticker?, isExplicitBuy?,
  direction?, reason }`. `reason` is the audit trail (e.g. the verbatim quote + why).
- `extract`/`score` applies overrides as a final deterministic pass after classification,
  before the `isExplicitBuy && bullish` filter. Keyed by `(shortcode[, ticker])`.
- This also covers *removals*: an override `{ shortcode, isExplicitBuy: false, reason }`
  is the maintainable replacement for today's owner-DELETE (which loses the evidence).
  The DB reconciliation still needs an owner-DELETE when a previously-scored call is
  overridden off, but the override file records *why*, so re-runs stay consistent.

**Open questions.** Should overrides live in the DB (a real `call_overrides` table the
serve role can't see) instead of a static file, given DB-is-source-of-truth? Likely yes
long-term; a committed JSON is the cheap interim. How do overrides interact with the
parity check (DB vs static must still match after overrides are applied to both)?

## Out of scope (tracked elsewhere)
- IG `resume.ts` (mechanical post-review sync tail; currently manual — see review notes).
- `REVALIDATE_TOKEN` on the VM for instant CDN bust (6h TTL is the current floor).
- Partial-harvest guard at the scrape boundary (`try/finally` + min-count on
  `shortcodes.json`).
