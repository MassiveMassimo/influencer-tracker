# VM ingest ops runbook

Daily automated ingest for influencer-tracker. Two-stage: a systemd timer runs
stage 1 (scrape + extract), then pauses for human review; the operator runs stage 2
(score + sync + parity + revalidate) manually over SSH after approving the calls.

---

## 1. One-time VM setup

### Clone via read-only deploy key

Add a read-only SSH deploy key to the repo, install it at `~/.ssh/deploy_rsa` on the
VM, and configure `~/.ssh/config`:

```
Host github.com
  IdentityFile ~/.ssh/deploy_rsa
  IdentitiesOnly yes
```

Then clone:

```bash
git clone git@github.com:MassiveMassimo/influencer-tracker.git ~/influencer-tracker
cd ~/influencer-tracker
bun install
```

### Seed per-creator state (required before first run)

`reel-calls.json`, `raw/`, and `prices/` under `data/creators/<h>/` are gitignored —
absent on a fresh clone. Rsync them from the Mac (source-of-truth checkout) for each
existing X creator before the timer fires, or the first scrape starts from empty and
a `db:sync` will corrupt that creator's stats.

Run this from the Mac for each handle:

```bash
rsync -a data/creators/<h>/{reel-calls.json,raw,prices} \
  ubuntu@imos-vm:~/influencer-tracker/data/creators/<h>/
```

Repeat for every handle listed in `INGEST_HANDLES`.

### Populate `.env`

Create `/home/ubuntu/influencer-tracker/.env` with:

```
DATABASE_URL_INGEST=...      # ingest role connection string (INSERT/UPDATE on creators/calls/artifacts, INSERT-only on prices)
DATABASE_URL_SERVE=...       # serve role connection string (SELECT-only; parity-check reads this)
GROQ_API_KEY=...
FIREWORKS_API_KEY=...
RETTIWT_API_KEY=...          # base64 cookie key from throwaway X account
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
INGEST_HANDLES=handle1,handle2,...   # comma-separated list of X handles to ingest
REVALIDATE_TOKEN=...         # on-demand ISR bypass token — must match the value baked into the Vercel build
VITE_SITE_URL=https://influencer-tracker-beta.vercel.app   # prod origin for revalidate calls
```

> **`REVALIDATE_TOKEN`** must be a sufficiently long random secret (Vercel expects ~32 chars;
> generate with `openssl rand -base64 32`). It must be IDENTICAL in the Vercel build env and
> this `.env` — a mismatch means on-demand revalidation silently no-ops (the 6h ISR TTL still heals).

### Install and enable the systemd units

```bash
sudo cp ~/influencer-tracker/ops/influencer-ingest.service /etc/systemd/system/
sudo cp ~/influencer-tracker/ops/influencer-ingest.timer   /etc/systemd/system/
sudo cp ~/influencer-tracker/ops/notify-fail.service       /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now influencer-ingest.timer

# Confirm the timer is scheduled
systemctl list-timers influencer-ingest.timer
```

---

## 2. Daily flow

### Stage 1 — automated (13:00 UTC)

The timer fires `influencer-ingest.service`, which:

1. Acquires `/tmp/influencer-ingest.lock` (exclusive; waits up to 2h via `flock -w 7200`).
2. Discards tracked VM writes and any untracked new-symbol price files, then pulls
   fresh from `main` (see §4 for why).
3. Runs `scripts/ingest.ts` for every handle in `INGEST_HANDLES`: forward scrape
   (tweets since last run), extract calls via Fireworks, write `reel-calls.json` and
   `calls.review.md`, then pause.
4. Telegrams the operator a review ping with the exact command to inspect the output.

### Stage 2 — manual (operator, over SSH)

Review the extracted calls on the VM:

```bash
ssh ubuntu@imos-vm "cat ~/influencer-tracker/data/creators/<handle>/calls.review.md"
```

(The Telegram ping includes this exact command for the relevant handle.)

If the calls look correct, run the resume:

```bash
ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts <handle>"
```

The `flock` here uses the **same lock file** as the timer, so the two can never run
concurrently. The manual resume blocks until it acquires the lock; if the timer fires
while a resume is running (unlikely but possible near 13:00 UTC) it waits up to 2h
(`flock -w 7200`) and only the `notify-fail` dead-man fires if it still can't acquire
it. Run one handle at a time if ingesting multiple handles on the same day.

---

## 3. What resume does

`scripts/resume.ts` runs these stages in order:

1. **Guard** — checks that the new `reel-calls.json` did not shrink materially vs the
   prior run. Refuses to continue if it did (data-loss prevention; surface the diff
   and investigate manually).
2. **Score** — computes forward-return accuracy (1w/1m/3m/to-date vs SPY) for all
   explicit bullish calls. Rewrites `dataset.json`, `index.json`, and per-symbol
   files in `data/prices/`.
3. **Scoped backfill** (`scripts/backfill.ts <handle>`) — upserts only the reviewed
   creator's calls/prices into Neon (insert-only on prices), then runs
   `db:materialize` to rebuild the global calls-index artifact from the DB.
   Scoped to avoid overwriting other creators' live DB rows with today's reset
   static files.
4. **Scoped parity check** (`scripts/parity-check.ts <handle>`) — asserts DB
   reassembly equals static JSON for this creator's dataset and prices. Must print
   `PARITY OK` before proceeding.
5. **Revalidate** (`scripts/revalidate-creator.ts`, best-effort) — GETs the affected
   creator + ticker paths (`/c/<h>`, `/api/dataset/<h>`, `/explore`, `/api/calls-index`,
   each `/t/<sym>` + `/api/prices/<sym>`) against `VITE_SITE_URL` with header
   `x-prerender-revalidate: <REVALIDATE_TOKEN>` — Vercel's on-demand prerender bypass.
   The build bakes the same `REVALIDATE_TOKEN` into each ISR route's prerender config
   (`vite.config.ts` `nitro.vercel.config.bypassToken`), so the sent token must equal the
   build-time value. Never throws; if it's skipped or the token is unset, the 6h ISR TTL
   still refreshes the CDN. (The older `/api/revalidate` POST seam still exists but is an
   inert 3a stub — it is *not* what resume calls.)

If any step fails, resume exits with a non-zero code. Failures surface in the operator's
terminal (SSH session); resume has no `notify` call — only stage-1 `ingest.ts` and the
`notify-fail` systemd unit send Telegram alerts.

**Known limitation.** A creator with no new reviewed calls is never resumed, so its
existing calls' to-date and recent-horizon returns do not mature in the DB until its next
reviewed call (or a manual full re-score + redeploy from the Mac). Accepted for semi-auto;
the Plan-4 judge + per-call approval state is the eventual fix.

---

## 4. Ephemeral-scratch note

`USE_DB=1` in production means Neon is the source of truth. The VM's static files
(`dataset.json`, `index.json`, `data/prices/*.json`) are scratch — they get rewritten
by `score` on every resume and discarded at the top of the next stage-1 run.

Before each stage-1 run the service does:

```bash
git checkout -- data/        # reset all tracked files under data/ to HEAD
git clean -fd data/prices/   # drop untracked new-symbol price files (scoped — never touches data/creators/)
git pull --ff-only            # pull latest main
```

`data/creators/` is intentionally excluded from the clean: it holds seeded state
(`reel-calls.json`, `raw/`, `prices/`) that is gitignored and must survive across runs.

Accepted drift while `USE_DB=1`: the static panic-fallback JSON, baked OG cards, and
per-call spark arrays go stale between manual redeploys. This is fine — the live DB
path serves all normal traffic; the static files are only a fallback and a build-time
input, not a runtime dependency.

---

## 5. Failure handling

- **`notify-fail.service`** is declared in `influencer-ingest.service`'s `OnFailure=`
  directive. If the ingest unit exits non-zero or is killed (timeout, OOM, etc.) and
  the wrapper's own try/catch did not fire, systemd triggers `notify-fail.service`,
  which calls `scripts/notify.ts` directly and sends a Telegram alert.
- **`RuntimeMaxSec=4h`** is the dead-man timeout. If the ingest hangs for more than
  four hours, systemd kills the unit and `notify-fail.service` fires.
- To inspect a failed run: `journalctl -u influencer-ingest.service -n 100 --no-pager`
- To trigger a manual test run: `sudo systemctl start influencer-ingest.service` — runs the
  same `ExecStart` (same `flock`); it does NOT skip the lock.
