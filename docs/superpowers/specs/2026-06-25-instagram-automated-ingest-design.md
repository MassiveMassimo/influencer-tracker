# Instagram automated daily ingest — design

**Date:** 2026-06-25
**Status:** design (approved approach, pre-plan)

## Problem

The VM's daily ingest is **X-only**. The three Instagram creators
(`kevvonz`, `roadto100kportfolio`, `johnnylixf`) only refresh when someone runs
the pipeline by hand, so they drift stale (roadto100k was 7 days behind when this
was raised). The IG *pipeline* works and has been run manually on the VM (proven
2026-06-13; a one-shot `/tmp` runner onboarded two creators 2026-06-18), but no
recurring scheduler exists. `scripts/ingest.ts` and `scripts/resume.ts` hardcode
`pipeline:x`, and `ingest.ts` actively *skips* IG handles (`looksInstagram`) to
stop an X-scrape from clobbering IG data.

Goal: IG creators refresh automatically every day, as close to "fresh like X" as
the platform allows.

## The inherent ceiling (accepted)

IG automation cannot be as bulletproof as X, and the design accepts this rather
than pretending otherwise:

- **X** authenticates with an HTTP API key (`RETTIWT_API_KEY`). Headless, daily,
  fails cleanly when the key dies (manual rotate).
- **IG** requires a *headful, logged-in browser session* (the `imtiddies` burner
  in a persistent `.chrome-profile`), routed through a **residential SOCKS proxy**
  (`IG_PROXY`, the iProyal relay) because IG locks accounts scraped from datacenter
  IPs. IG periodically expires the session or throws a login checkpoint. Recovery
  is a **manual VNC re-login** — it cannot be automated away.

So "fresh like X" = **automated best-effort daily, with a manual re-auth when IG
kills the session**. The design surfaces a session death as a BLOCKED Telegram
alert (with the re-auth runbook) and keeps serving last-good data; it never
hard-fails the whole run or corrupts data. This is the same operational shape as
X (whose key also needs occasional manual rotation), just with a browser session
instead of an API key.

**Cadence: daily** (user decision — maximum freshness, accepting higher lock
risk). The forward-scroll bound (below) is the primary mitigation: a smaller
scroll footprint per run means a smaller bot signature at daily cadence.

## Approach (chosen: A — separate IG path + separate timer)

Keep the fragile IG browser path physically isolated from the reliable X path, so
an IG session death can never stall or corrupt the X run (and vice versa). This
mirrors the existing split (`run.ts` vs `run-x.ts`; the `looksInstagram` guard).
Rejected alternative B (one unified ingest branching by platform) couples a
browser process that can hang on a dead session into the same run/lock as X.

### New / changed components

| Unit | What it does | Mirrors |
|---|---|---|
| `scripts/ingest-ig.ts` | Daily IG entrypoint: for each IG handle, run the IG pipeline (forward) → resume (guard → prices → score); then one commit+push of `data/`. Symmetric platform guard. | `scripts/ingest.ts` |
| `pipeline/scrape.ts` (edit) | Add a **forward** mode: stop scrolling once caught up to already-harvested reels, instead of re-walking 12 months daily. | X `scrapeX(…, {forward})` |
| `pipeline/run.ts` (edit) | Thread a `--forward` flag through to `scrape()`. | `run-x.ts` |
| `scripts/resume.ts` (edit) | Optional platform arg (default `pipeline:x`); IG passes the IG pipeline. prices+score are already platform-agnostic. | — |
| `ops/influencer-ingest-ig.service` + `.timer` | Second systemd timer, staggered after the X timer, under `xvfb-run` with `IG_PROXY` set and its own flock. | `influencer-ingest.{service,timer}` |

`prices.ts`, `score.ts`, `guard-no-shrink.ts`, `transcribe.ts`, `frames.ts`,
`extract.ts`, `notify.ts` are reused unchanged.

## Data flow (one daily IG run)

```
ingest-ig.ts (under xvfb, IG_PROXY set, own flock)
  for each handle in INGEST_HANDLES_IG:
    guard: skip if handle looks like X (majority-numeric shortcodes) → BLOCKED alert, continue
    pipeline (run.ts) --handle h --name n --forward:
        scrape(forward)  → harvest only reels newer than what we already have;
                           download new reels (yt-dlp via proxy); abort if proxy egress fails
        transcribe       → new reels only (idempotent skip)        [self-hosted Parakeet, free]
        frames           → new reels only (idempotent skip)        [Fireworks vision, ~cents/day]
        extract          → re-classify all transcripts (text-only) [Fireworks text, ~cents/day]
                           PAUSE (run.ts breaks here)
    resume.ts h ig:
        guard-no-shrink  → abort this handle if scored count collapsed (truncated scrape)
        pipeline --from prices → prices (forward-extend, split-safe) + score (overrides, scope, company)
  git add data/ → commit → pull --rebase (abort on conflict) → push   [redeploys Vercel static]
```

### Forward-scroll bound (the one non-trivial new mechanism)

IG's `scrape()` currently scrolls the `/reels/` page back to a 12-month cutoff (or
until 4 stagnant rounds). For a daily run that re-walks the full year every time —
slow and a large bot footprint.

- **Anchor source:** the set of shortcodes that already have a transcript on the VM
  (`transcriptsDir(handle)/*.json`). Transcripts are the durable per-reel artifact;
  they survive the documented `raw/`+`frames/` cleanup (unlike X's anchor, which
  lives in the purgeable `raw/tweets.json` — IG's anchor is *more* robust).
- **Stop rule:** reels render newest-first, so once a scroll round surfaces only
  already-known shortcodes (no new codes for N rounds), we have caught up — break.
  Keep the existing 12-month cutoff and stagnant-break as fallbacks.
- **Pinned-reel caveat:** pinned reels can appear at the top out of date order, so
  do not stop on the *first* known code; require a run of known-only rounds *after*
  at least one new code (or none-new across the whole first screen → nothing new
  today, exit fast). Extract the stop decision into a pure helper so it is unit-
  testable without a browser (mirrors X's forward-anchor helper).
- **Fallback:** no transcripts present (fresh VM seed) → no anchor → full 12-month
  backfill, exactly like X's first run. One-time, acceptable.

## Error handling

- **Dead/challenged IG session** — `scrape()` already throws
  `"IG session rejected (expired/challenged) — re-login the .chrome-profile (VNC)…"`.
  Caught per-handle in `ingest-ig.ts` → BLOCKED Telegram alert carrying that
  message → skip handle, keep last-good data. Human re-auths via VNC, next run
  recovers.
- **Proxy egress failure** — `scrape()` already aborts loudly
  (`scrape.ts:110`) before any scrape, so a relay outage never scrapes from the
  datacenter IP (which would get the burner locked). → BLOCKED alert.
- **Truncated scrape** — `guard-no-shrink.ts` runs before `score` overwrites the
  committed baseline; a collapse aborts that handle (no publish).
- **Per-handle isolation** — one handle's failure never aborts the others or the
  final publish; mirrors `ingest.ts`.
- **Git publish** — single commit + `pull --rebase` (abort-on-conflict) + push,
  copied verbatim from `ingest.ts`. The IG timer is **staggered** after the X
  timer so the two pushes rarely race; the rebase-abort path covers the rest.
- **Exit non-zero on any failure** so `OnFailure=notify-fail.service` (dead-man)
  fires even if `notify()` itself is down.

## Scheduling & environment

- `ops/influencer-ingest-ig.timer` — daily, **staggered** ~1h after the X timer
  (X fires 13:00 UTC → IG ~14:00 UTC) so the headful run and the second git push
  don't collide with X.
- `ops/influencer-ingest-ig.service` — `ExecStart` wraps the run in `xvfb-run -a`
  (the VM is headless; `scrape()` launches `headless:false`), exports `IG_PROXY`,
  holds its own `/tmp/influencer-ingest-ig.lock` flock, and runs the same
  `git checkout -- data/ && git clean -fd data/ && git pull --ff-only` baseline
  reset as `ExecStartPre`.
- New env: `INGEST_HANDLES_IG=kevvonz,roadto100kportfolio,johnnylixf`. `IG_PROXY`
  already set on the VM. Notify path (`HERMES_BIN`) already configured.

## Cost

- Transcribe: self-hosted Parakeet (CPU) — free.
- Vision (frames): Fireworks `kimi-k2p5`, new reels only — a few reels × 3 frames
  per creator per day ≈ cents.
- Extract: re-classifies all transcripts but **text-only** (`deepseek-v4-flash`,
  $0.14/1M in), vision hints read from disk — cents/day.
- An extract-done cursor (skip already-classified transcripts) is **not** built
  initially (YAGNI — full re-extract is already cheap and keeps the multi-ticker
  prompt applied to all reels); add it only if daily text cost becomes material.

## Testing

- `ingest-ig.ts` IG-detection guard — unit test mirroring `ingest.ts`'s
  `looksInstagram` (majority non-numeric → IG; majority numeric → skip).
- Forward-scroll **stop-decision helper** — pure unit tests (known/new code sets,
  pinned-reel edge, nothing-new-today, fresh-seed fallback). No browser in tests.
- `resume.ts` platform arg — assert default stays `pipeline:x` (X path unchanged).
- Reused stages keep their existing tests; `guard-no-shrink`, prices, score
  unchanged.

## Out of scope

- New-IG-creator onboarding stays manual (matches X — onboarding is manual there
  too).
- Automated session re-auth (impossible without defeating IG's checkpoint).
- DB sync / parity / ISR revalidate — serve path is static (`USE_DB=0`); the
  publish is the git push, same as X.

## Security

- The `imtiddies` burner's `cookies.txt` and `.chrome-profile` are
  credential-equivalent: must stay gitignored and `chmod 600` on the VM (verify in
  the plan). Cookie bytes are never logged (the existing scrape teardown rewrites
  them silently).
