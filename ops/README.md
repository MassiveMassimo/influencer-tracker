# VM ingest ops runbook

Daily automated ingest for influencer-tracker. The systemd timer runs scrape + extract +
score per handle, then commits + pushes the refreshed `data/` once (Vercel auto-deploys the
fresh static — serve path is static, `USE_DB=0`; see CLAUDE.md "Data source" REVERTED banner,
2026-06-22). No human review step — Telegram reports published results or sends a BLOCKED alert
on guard/score/push failure. The DB is no longer synced on this path; it backs only the
correction loop (`/api/report`, overrides).

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
the commit+push would clobber that creator's stats with a degenerate dataset.

Run this from the Mac for each handle:

```bash
rsync -a data/creators/<h>/{reel-calls.json,raw,prices} \
  ubuntu@imos-vm:~/influencer-tracker/data/creators/<h>/
```

Repeat for every handle listed in `INGEST_HANDLES`.

### Populate `.env`

Create `/home/ubuntu/influencer-tracker/.env` with:

Daily-path keys (static-serve, `USE_DB=0`) — the only ones the timer actually needs:

```
FIREWORKS_API_KEY=...        # vision + classification (IG + X)
RETTIWT_API_KEY=...          # base64 cookie key from throwaway X account
# Notify path — set EITHER Hermes (preferred on the VM) OR the raw Telegram bot creds:
HERMES_BIN=/home/ubuntu/.hermes/hermes-agent/venv/bin/hermes   # reuses Hermes's own Telegram creds + home channel; no bot token needed here
# HERMES_TARGET=telegram     # optional override of the Hermes send target (default "telegram" = home channel)
# TELEGRAM_BOT_TOKEN=...      # fallback path if HERMES_BIN unset
# TELEGRAM_CHAT_ID=...
INGEST_HANDLES=handle1,handle2,...   # comma-separated list of X handles to ingest
IG_PROXY=socks5://127.0.0.1:1081   # VM-only: route IG scrape+yt-dlp through the iProyal ISP residential relay (no-auth local). Unset on the Mac (scrapes direct). Datacenter IP gets IG accounts locked.
```

Correction-loop / dormant-revival keys — NOT used by the daily run. Set only if you
run a manual DB override (`apply-override`, needs `DATABASE_URL_INGEST`) or ever
re-enable the `USE_DB=1` serve path:

```
DATABASE_URL_INGEST=...      # ingest role: apply-override writes call_overrides; backfill/materialize (dormant)
DATABASE_URL_SERVE=...       # serve role (SELECT-only); parity-check reads this (dormant)
DATABASE_URL_REPORT=...      # report role (INSERT-only on call_reports); used by Vercel /api/report, not the VM
REPORT_SALT=...              # random >=16 chars; salts the IP dedupe hash — generate: openssl rand -base64 32 | tr -d '/+=' | head -c 40
REVALIDATE_TOKEN=...         # dormant: only the USE_DB=1 revalidate-creator path uses it (daily push auto-deploys instead)
VITE_SITE_URL=https://influencer-tracker-beta.vercel.app   # prod origin (used by the dormant revalidate path)
```

> **`REVALIDATE_TOKEN` is off the daily path now.** Under static-serve the daily push
> redeploys Vercel directly (fresh static, no ISR bust needed), so the daily run does
> **not** call `revalidate-creator.ts`. The token + that script survive only for a
> future `USE_DB=1` revival, where on-demand ISR busting matters again. If you do revive
> it, the token must be **identical** in the Vercel production env (baked into each ISR
> route's `.prerender-config.json` at build) and this VM `.env` (read at runtime); a
> mismatch silently no-ops the bust (the 6h ISR TTL still heals).
>
> Generate: `openssl rand -base64 32 | tr -d '/+=' | head -c 40`

### Install the Parakeet ASR runtime (IG transcription)

The IG `transcribe` stage runs **self-hosted Parakeet** on CPU (no GPU) instead of
Groq Whisper. `transcribe.ts` shells the wav batch to `pipeline/asr/transcribe_parakeet.py`
using the `~/asr-venv` interpreter (override with `PARAKEET_PYTHON`). One-time:

```bash
sudo apt-get install -y ffmpeg python3-venv      # ffmpeg also needed by the frames stage
python3 -m venv ~/asr-venv
~/asr-venv/bin/pip install onnx-asr onnxruntime soundfile huggingface_hub
# warm the model cache (first load downloads ~600 MB from HF):
~/asr-venv/bin/python -c 'import onnx_asr; onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v2")'
```

X has no audio, so this is only needed on a VM that ingests IG. Benchmark on the
4-core ARM VM: RTF ~0.17 (≈6x faster than realtime).

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

### Automated run (13:00 UTC)

The timer fires `influencer-ingest.service`, which:

1. Acquires `/tmp/influencer-ingest.lock` (exclusive; waits up to 2h via `flock -w 7200`).
2. Discards tracked VM writes and any untracked new-symbol price files, then pulls
   fresh from `main` (see §4 for why).
3. Runs `scripts/ingest.ts` for every handle in `INGEST_HANDLES`: forward scrape
   (tweets since last run), extract calls via Fireworks, write `reel-calls.json` and
   `calls.review.md`, then immediately auto-invokes `scripts/resume.ts` per handle —
   no human pause.
   After all handles, `ingest.ts` commits + pushes `data/` once (Vercel auto-deploys the
   fresh static). A handle BLOCK or a failed push makes the run exit non-zero so the
   `notify-fail` `OnFailure` dead-man fires even if the Telegram send is down.
4. Per-handle Telegram messages:
   - **Published:** handle scored; `data/` committed + pushed → Vercel redeploys static — no action needed.
   - **BLOCKED:** `guard-no-shrink` or score failed (or the push/rebase failed); the message
     includes the manual re-run command for investigation.

### Manual resume — BLOCKED investigation / post-override re-score

Only needed when the automated run sends a BLOCKED alert or after applying a human
override (flag correction via the report→override loop). Use the `flock` guard to
avoid racing the timer:

```bash
ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock ~/.bun/bin/bun run scripts/resume.ts <handle>"
```

The `flock` uses the **same lock file** as the timer, so the two can never run
concurrently. The manual resume blocks until it acquires the lock; if the timer fires
while a resume is running it waits up to 2h (`flock -w 7200`) and the `notify-fail`
dead-man fires if it still can't acquire it. Run one handle at a time.

---

## 3. What resume does

`scripts/resume.ts` runs these stages in order (static-serve, 2026-06-22):

1. **Guard** — checks that the new `reel-calls.json` did not shrink materially vs the
   prior run. Refuses to continue if it did (data-loss prevention; surface the diff
   and investigate manually).
2. **Score** — computes forward-return accuracy (1w/1m/3m/to-date vs SPY) for all
   explicit bullish calls; applies operator overrides (`db/overrides.ts`, fail-open).
   Rewrites `dataset.json`, `index.json`, and `data/prices.db`.

That's it — `resume.ts` no longer touches the DB. **Publishing happens at the `ingest.ts`
level**: after all handles score, it `git add data/ && commit && pull --rebase && push origin
main`. The push triggers Vercel's auto-deploy, which serves the fresh static (`USE_DB=0`). For a
**manual** override re-score, run `resume.ts <handle>` then commit + push `data/` yourself to
publish. (The former DB stages — scoped `backfill` → `db:materialize` → `parity-check` →
`revalidate-creator` — were removed when the serve path returned to static. The scripts still
exist for a future `USE_DB=1` revival but are off this path.)

If any step fails, resume exits with a non-zero code. In the automated run, `ingest.ts` catches
the failure and sends a BLOCKED Telegram alert with the manual re-run command; a failed `push`
(after a successful commit) also sends a BLOCKED alert. The `notify-fail` systemd unit is the
backstop if the process is killed before it can notify. In a manual SSH session, failures
surface in the terminal only.

Every active handle re-scores on every daily run (always-resume), so overrides and
to-date/recent-horizon returns mature for all creators without needing a new reviewed call.

---

## 4. Clean-baseline-then-regenerate note

Static-serve (`USE_DB=0`): the committed `data/` files **are** the product. `score`
rewrites `dataset.json`, `index.json`, and `data/prices.db`; `ingest.ts` then
commits + pushes them, and that push is what redeploys Vercel. The pre-run reset is
**not** a "discard scratch" step — it just resets to a clean remote baseline so `score`
regenerates the exact diff that gets committed (no stale local churn carried forward).

Before each run the service does:

```bash
git checkout -- data/   # reset all tracked files under data/ to remote HEAD
git clean -fd data/     # drop untracked non-ignored files (safe — .gitignore shields raw/, frames/, transcripts/, cookies.txt)
git pull --ff-only      # pull latest main
```

`git clean -fd data/` (no `-x`) is safe across all of `data/`: seeded per-creator state
(`raw/`, `frames/`, `transcripts/`, `cookies.txt`) is gitignored, so `clean` leaves it
untouched and only removes untracked non-ignored files.

**Exception — do NOT purge `raw/<handle>/tweets.json` for X creators.** It is the
incremental forward-scrape cursor (newest stored tweet id); losing it forces a full
12-month re-backfill (re-scrape + full re-extract, Fireworks $). The mp4/img media in
`raw/` is still safe to delete; `tweets.json` is not.

---

## 5. Failure handling

- **`notify-fail.service`** is declared in `influencer-ingest.service`'s `OnFailure=`
  directive. If the ingest unit exits non-zero or is killed (timeout, OOM, etc.) and
  the wrapper's own try/catch did not fire, systemd triggers `notify-fail.service`,
  which calls `scripts/notify.ts` directly and sends a Telegram alert.
- **`RuntimeMaxSec=4h`** is the dead-man timeout. If the ingest hangs for more than
  four hours, systemd kills the unit and `notify-fail.service` fires. Bump to `6h` in
  `influencer-ingest.service` if `INGEST_HANDLES` grows to 10+ handles.
- To inspect a failed run: `journalctl -u influencer-ingest.service -n 100 --no-pager`
- To trigger a manual test run: `sudo systemctl start influencer-ingest.service` — runs the
  same `ExecStart` (same `flock`); it does NOT skip the lock.

---

## Instagram daily ingest (separate timer)

`influencer-ingest-ig.{service,timer}` refresh the IG creators (`INGEST_HANDLES_IG`)
daily at 14:00 UTC — staggered 1h after the X ingest so the two pushes do not race.
The service runs `scripts/ingest-ig.ts` under `xvfb-run` (headful Chrome needs a
display) with `IG_PROXY` set (residential egress; the burner is never seen from the
datacenter IP). It scrapes forward-incrementally (only reels newer than the durable
transcript anchor), auto-resumes past the review pause (ship-then-correct), and
commits+pushes `data/` once.

**Required `.env` keys:** `INGEST_HANDLES_IG=kevvonz,roadto100kportfolio,johnnylixf`,
`IG_PROXY=socks5://127.0.0.1:1081` (already set).

**Session death is manual to recover:** when IG expires/challenges the `imtiddies`
session, the run sends a BLOCKED alert (carrying the VNC-re-auth + re-run steps) and
the creator stays at last-good data. Re-login the `.chrome-profile` via VNC through the
proxy, then re-run the handle.

**Operator caveats (load-bearing):**

- **Stop the timer during VNC re-auth.** The unattended run and a VNC Chrome share the
  one `.chrome-profile`; two Chromes on the same profile collide on `SingletonLock` (the
  flock guards only the script, not the profile). Before re-authing:
  `sudo systemctl stop influencer-ingest-ig.timer`, re-login, then `start` it again.
- **The forward anchor is VM-local.** `knownShortcodes()` reads `transcripts/`, which is
  gitignored (so `git clean -fd data/` never wipes it — that is _why_ the ExecStartPre
  clean is safe). A fresh VM seed with no transcripts → one-time full 12-month backfill.
- **First run on an unseeded profile blocks ~6 min** waiting for a manual login it can't
  get under xvfb, then throws. Seed the session once via VNC before enabling the timer.

Install (one-time): copy both units into `/etc/systemd/system/`,
`sudo systemctl daemon-reload && sudo systemctl enable --now influencer-ingest-ig.timer`.
