# Augustus ingest repair

Approved, deployed, and verified on 2026-10-03. X ingestion is restored.
Instagram remains blocked by its saved session and requires manual login.

## Confirmed causes

- The VM's default Hermes notification token identifies `I_AugustusBot`.
- Both ingest services failed repeatedly. X reported `Unknown error`; a read-only
  diagnostic exposed `ONDEMAND_FILE_URL_RESOLUTION_ERROR` before the search request.
- The live VM had Rettiwt 7.1.2 installed despite a newer repository declaration.
- Instagram rejected its saved session. Its MacBook relay was intermittent, but
  a proxy request to Instagram returned HTTP 200 during this inspection.
- Per-creator alerts were followed by a generic systemd alert for the same failure.

## Repair

Use Rettiwt 7.1.4 and align installed packages with the frozen lockfile on each run.
The [upstream patch](https://github.com/Rishikant181/Rettiwt-API/releases/tag/7.1.4)
repairs transaction generation. Preserve safe X status/code diagnostics for retry
decisions. Bound notification sends and the X oneshot service.

Shared platform failures stop after one creator. Alert state survives process
restarts and data cleanup. Unchanged failures get a 24-hour reminder. The
independent systemd backstop remains active for crashes, timeouts, failed sends,
and missing state. It suppresses only a completed, handled invocation.

Send published messages after publishing succeeds. Retry outstanding local data
commits even when a later run has no new diff.

## Evidence

- A Rettiwt 7.1.4 canary on the VM fetched one tweet using the existing throwaway
  account key. It ran in a separate temporary directory, without data writes,
  Telegram messages, or changes to the live dependency installation.
- Typecheck, lint, formatting, and build passed.
- Full suite: 404 passed, 47 skipped, 0 failed, across 86 files. The skipped tests
  remain the suite's environment-dependent checks.
- Wrapper integration tests cover shared failures, restart deduplication, failed
  publishing, and retrying an outstanding commit without a new diff.
- A mutation of the invocation comparison failed its regression test. Restoring
  the comparison passed.
- The repaired systemd units passed syntax verification on the VM. Existing host
  unit warnings were unrelated to these files.

## Live verification

- Repair commit `b7e7690` and security patch `be72c70` reached main and the VM.
  Both services and `notify-fail@.service` are installed. systemd was reloaded.
  Both ingest startup timeouts are four hours. Both daily timers remain active.
- X invocation `fc629b49fb88438187d645733f31f96e` completed with exit status 0.
  Both configured X creators completed. Refreshed data was published in `4ed9680`.
  The invocation was recorded as completed and handled, with no active incident.
- The scheduled Instagram invocation `5bd5f96c32664fb9a7db397d13056527`
  waited for the shared lock, then stopped at the session rejection. It sent one
  platform alert. The backstop logged `completed failure already reported; no
  duplicate alert`. Its nonzero exit status remains visible to systemd.
- A routine repair-status message through the documented Hermes CLI returned
  `success: true`, platform `telegram`, and message ID `11441`. This confirms
  provider acceptance; it does not assert that the owner read the message.
- Vercel production deployment `dpl_FHyR4wCud8zPgnr4gq76arj327Hj` is Ready
  for the published data commit. The production dashboard and a creator page
  rendered correctly in the built-in browser, with no captured warnings or errors.
  The dashboard showed refreshed X data at `1d ago`.
- A locked VM sync confirmed Start `1.168.60` and Rettiwt `7.1.4` installed.
  The pre-existing untracked VM scripts were preserved.

## Remaining owner action

Instagram needs a manual burner-account login through the proxy before live
ingestion can succeed. Do not automate that login. The MacBook relay still needs
the MacBook online and awake. Changing that dependency requires a separate owner
choice; this repair does not introduce a new proxy service or billing.

The deployment commands and recovery procedures are in `ops/README.md`.

## Production build blocker

The first Vercel deployment of the repair was blocked before the build because
the existing `@tanstack/react-start@1.168.49` is affected by
[CVE-2026-102989](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8).
Update Start to its first patched version, `1.168.60`, and align the direct React
Router dependency to `1.170.41`, which that Start release uses. The Vercel security
bypass was not enabled. No application architecture or framework was changed.

The patched dependency installation passed typecheck, lint, formatting, the full
suite with 404 passed and 47 skipped, and the production build. Production
redeployment is verified above.

## Retained artifacts

The VM retains the three previous unit files under
`~/.local/state/influencer-tracker/augustus-repair-20261003/` for rollback.
Task-created canary directories, feature-worktree dependencies, build output,
and generated public assets were removed after verification. Source and compact
evidence remain in the repair worktree and this record.
