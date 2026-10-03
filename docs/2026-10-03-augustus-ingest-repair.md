# Augustus ingest repair

Prepared and approved for deployment on 2026-10-03. Live verification is in progress.

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

## Remaining live work

After owner approval, commit and merge the repair, push main, update the VM
checkout and lockfile installation, install both services plus `notify-fail@.service`,
and reload systemd. Run X ingest and inspect its exit status, data publication,
and notification result. A push to main triggers the existing Vercel deployment.

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
suite with 404 passed and 47 skipped, and the production build. Live redeployment
verification is in progress.
