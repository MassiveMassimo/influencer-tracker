# Task 8 — VM ingest provisioning (one-time, copy-paste)

Stand up the Plan 3b daily X-ingest on the ARM Ubuntu VM (`ssh ubuntu@imos-vm`,
repo at `~/influencer-tracker`). The _code_ is already deployed to prod
(`USE_DB=1`, Neon-backed serve path live); this stands up the automation that
keeps it fresh without a redeploy.

Reference: `ops/README.md` is the canonical operational doc. This file is the
sequenced first-time setup with concrete values filled in (`INGEST_HANDLES`,
`VITE_SITE_URL`) and smoke + dead-man tests. Run top-to-bottom; each block has a
checkpoint.

Current X creator (numeric tweet-id shortcodes): **TheProfInvestor**.
`kevvonz` is Instagram — manual onboarding, not part of the daily timer.

---

## 0. Prereqs on the VM

```bash
ssh ubuntu@imos-vm
# bun (units hardcode ~/.bun/bin) + tooling
command -v bun || curl -fsSL https://bun.sh/install | bash
command -v flock && command -v rsync && command -v git \
  || (sudo apt-get update && sudo apt-get install -y util-linux rsync git)
bun --version   # checkpoint: prints a version; binary at ~/.bun/bin/bun
```

## 1. Clone via read-only deploy key

GitHub → repo → Settings → Deploy keys → add the VM's public key (read-only).
Then on the VM:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_rsa
  IdentitiesOnly yes
EOF
git clone git@github.com:MassiveMassimo/influencer-tracker.git ~/influencer-tracker
cd ~/influencer-tracker && bun install
# checkpoint: clone succeeds, node_modules populated
```

## 2. Seed TheProfInvestor's gitignored state — run on the Mac

`reel-calls.json` + `raw/` + `prices/` are gitignored, so absent on a fresh
clone. Without seeding, the first forward-scrape starts from empty and a
`db:sync` would corrupt the creator's stats. Run on the **Mac**:

```bash
rsync -a data/creators/TheProfInvestor/{reel-calls.json,raw,prices} \
  ubuntu@imos-vm:~/influencer-tracker/data/creators/TheProfInvestor/
```

## 3. `.env` on the VM

Copy connection strings + keys from the Mac's `.env` (scp/paste — don't retype
secrets). `REVALIDATE_TOKEN` must be **identical** to the value set in the Vercel
build env, or on-demand revalidation silently no-ops (the 6h ISR TTL still heals).

```bash
cat > ~/influencer-tracker/.env <<'EOF'
DATABASE_URL_INGEST=...      # ingest role: INSERT/UPDATE creators/calls/artifacts, INSERT-only prices
DATABASE_URL_SERVE=...       # serve role: SELECT-only; parity-check reads this
FIREWORKS_API_KEY=...        # X text + vision classification
RETTIWT_API_KEY=...          # base64 cookie key from a THROWAWAY X account
# Notify path — set EITHER Hermes (preferred on the VM) OR the raw Telegram bot creds:
HERMES_BIN=/home/ubuntu/.hermes/hermes-agent/venv/bin/hermes   # reuses Hermes's Telegram creds + home channel
# TELEGRAM_BOT_TOKEN=...      # fallback path if HERMES_BIN unset
# TELEGRAM_CHAT_ID=...
INGEST_HANDLES=TheProfInvestor
REVALIDATE_TOKEN=...         # MUST match the Vercel build value
VITE_SITE_URL=https://influencer-tracker-beta.vercel.app
EOF
chmod 600 ~/influencer-tracker/.env
```

> `GROQ_API_KEY` is not needed — that's the Instagram path; VM ingest is X-only
> (Fireworks).

## 4. Install + enable the systemd units

```bash
sudo cp ~/influencer-tracker/ops/influencer-ingest.service /etc/systemd/system/
sudo cp ~/influencer-tracker/ops/influencer-ingest.timer   /etc/systemd/system/
sudo cp ~/influencer-tracker/ops/notify-fail.service       /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now influencer-ingest.timer
systemctl list-timers influencer-ingest.timer
# checkpoint: shows NEXT fire at the upcoming 13:00 UTC
```

## 5. Smoke-test stage 1 (manual trigger; no need to wait for 13:00 UTC)

```bash
sudo systemctl start influencer-ingest.service          # same ExecStart + flock
journalctl -u influencer-ingest.service -f --no-pager   # watch; Ctrl-C when done
```

Checkpoint: `git pull` → forward scrape → Fireworks extract → writes
`calls.review.md` → a **Telegram review ping arrives**. A first forward run may
find 0 new tweets if the seed is current — fine; it still pings.

## 6. Stage 2 dry-run — review then resume

```bash
ssh ubuntu@imos-vm "cat ~/influencer-tracker/data/creators/TheProfInvestor/calls.review.md"
# if calls look right:
ssh ubuntu@imos-vm "cd ~/influencer-tracker && \
  flock /tmp/influencer-ingest.lock bun run scripts/resume.ts TheProfInvestor"
```

Checkpoint: guard passes → score → scoped backfill + materialize →
**`PARITY OK`** → revalidate GETs fire. With `REVALIDATE_TOKEN` set correctly,
the prod creator/ticker pages refresh within seconds instead of the 6h TTL.

## 7. Dead-man test (verify failure alerting) — test both layers

```bash
# (a) notification path (Hermes via HERMES_BIN, or raw Telegram creds):
sudo systemctl start notify-fail.service
#     checkpoint: "ingest unit failed/timed out" alert arrives in Telegram

# (b) OnFailure wiring — force the ingest unit to fail via a temporary override:
sudo systemctl edit influencer-ingest.service
#     add exactly:
#         [Service]
#         ExecStart=
#         ExecStart=/bin/false
sudo systemctl start influencer-ingest.service
#     checkpoint: unit goes failed -> notify-fail fires -> Telegram alert arrives
sudo systemctl revert influencer-ingest.service   # remove the override
sudo systemctl daemon-reload
```

---

After step 7's revert, the timer is live and fires daily at 13:00 UTC. The only
recurring action is the stage-2 review+resume when the ping arrives.

Two values gate end-to-end correctness, both secrets you must place yourself:
`REVALIDATE_TOKEN` (identical in Vercel + this `.env`) and `RETTIWT_API_KEY`
(throwaway X account). See `ops/README.md` §3–§5 for what resume does, the
ephemeral-scratch git policy, and failure handling.
