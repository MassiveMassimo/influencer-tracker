# Plan 001: CI runs `bun test` + `bunx tsc --noEmit` on every PR

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- .github/ package.json`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live files before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

The repo's tests (`bun test`) and typecheck (`bunx tsc --noEmit`) both pass
locally, but **nothing enforces them**. The only CI job is
`.github/workflows/react-doctor.yml`, which runs a React linter — not the test
suite, not the type checker. So a PR with a type error or a failing test merges
and auto-deploys to production (Vercel deploys on push to `main`). This plan adds
a CI gate. It is the prerequisite that makes every other plan in this set safe to
execute: re-scored data and refactors can only be trusted if the test suite
actually runs in CI.

## Current state

- `.github/workflows/react-doctor.yml` — the only workflow. Runs `react-doctor` on PRs. Excerpt:
  ```yaml
  name: React Doctor
  on:
    pull_request:
      types: [opened, synchronize, reopened, ready_for_review]
  permissions:
    contents: read
    pull-requests: write
    issues: write
  concurrency:
    group: react-doctor-${{ github.event.pull_request.number || github.ref }}
    cancel-in-progress: true
  jobs:
    react-doctor:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v5
        - uses: millionco/react-doctor@main
  ```
- `package.json` scripts (current) — note there is **no** `typecheck` script:
  ```json
  "scripts": {
    "dev": "vite dev --port 3000",
    "prebuild": "bun run scripts/prebuild.ts",
    "build": "bun run scripts/prebuild.ts && vite build",
    "preview": "vite preview",
    "test": "bun test",
    "pipeline": "bun run pipeline/run.ts",
    "pipeline:x": "bun run pipeline/run-x.ts",
    "doctor": "npx react-doctor@latest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:backfill": "bun run scripts/backfill.ts",
    "db:roles": "bun run scripts/apply-roles.ts",
    "db:materialize": "bun run scripts/materialize.ts",
    "db:sync": "bun run db:backfill && bun run db:materialize"
  }
  ```
- The repo uses **Bun** (not npm/pnpm/yarn). `bun.lock` is committed. Tests import
  `bun:test`. The `#/` import alias maps to `src/`.
- Tests that require a database are **env-gated** and skip silently when
  `DATABASE_URL_TEST` etc. are unset (e.g. `db/backfill.test.ts`,
  `src/lib/db-read.test.ts`). CI will not set those, so those suites skip — that
  is expected and correct. Do **not** try to provision a test database in this
  plan.

## Commands you will need

| Purpose   | Command                | Expected on success               |
| --------- | ---------------------- | --------------------------------- |
| Typecheck | `bunx tsc --noEmit`    | exit 0, no output                 |
| Tests     | `bun test`             | exit 0, all pass (DB suites skip) |
| Lint YAML | (none — visual review) | —                                 |

(Verified during recon: both commands exit 0 at commit `fa39041`.)

## Scope

**In scope** (the only files you should modify/create):

- `.github/workflows/ci.yml` (create)
- `package.json` (add a `typecheck` script only)

**Out of scope** (do NOT touch):

- `.github/workflows/react-doctor.yml` — leave the existing workflow exactly as is.
- Any source file, test file, or config other than `package.json`'s scripts block.
- Do NOT add a linter/formatter, pre-commit hooks, or a test database — those are
  separate concerns, not this plan.

## Git workflow

- Branch: `advisor/001-ci-gate`
- Commit message style: conventional commits (repo convention — e.g.
  `ci: gate PRs on bun test + tsc`). See `git log --oneline -5`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `typecheck` script to package.json

In `package.json`, add one line to the `scripts` object (place it next to
`test`):

```json
"typecheck": "tsc --noEmit",
```

(Using `tsc` not `bunx tsc` inside the script is fine — `bun run typecheck`
resolves the local TypeScript. Keep `test` as `bun test`.)

**Verify**: `bun run typecheck` → exit 0, no errors.

### Step 2: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun test

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
```

Rationale for the choices, so you don't second-guess them:

- `oven-sh/setup-bun@v2` is the standard Bun setup action.
- `--frozen-lockfile` makes CI fail if `bun.lock` is out of sync rather than
  silently resolving new versions.
- Two separate jobs (not one) so a type error and a test failure are
  distinguishable at a glance in the PR checks UI.
- Runs on `push: main` too, so a direct push (the production deploy trigger) is
  also gated, not just PRs.

**Verify**:

- `bun run typecheck` → exit 0.
- `bun test` → exit 0 (DB-gated suites report as skipped, not failed).
- The YAML is valid (no tabs; 2-space indent). If you have `actionlint`
  available, `actionlint .github/workflows/ci.yml` → no errors; if not, review
  visually against the block above.

## Test plan

This plan adds CI config and one npm script; it changes no application logic, so
there are no new unit tests to write. Verification is that the two commands the
workflow runs both pass locally:

- `bun run typecheck` → exit 0
- `bun test` → exit 0, all non-skipped tests pass

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `.github/workflows/ci.yml` exists with a `test` job and a `typecheck` job
- [ ] `package.json` has a `"typecheck"` script
- [ ] `.github/workflows/react-doctor.yml` is unchanged (`git diff fa39041 -- .github/workflows/react-doctor.yml` is empty)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bun test` does **not** exit 0 at the current HEAD (a pre-existing failure is
  out of scope for this plan — report it; do not "fix tests to make CI green").
- `bunx tsc --noEmit` does not exit 0 at the current HEAD.
- The `package.json` scripts block doesn't match the excerpt above (drift).

## Maintenance notes

- When a future plan adds a linter/formatter (e.g. Biome/ESLint), add a third job
  here rather than folding it into `test`.
- If DB-backed tests should run in CI later, that needs a Postgres service +
  `DATABASE_URL_TEST` (a separate Neon branch). The env-gated `skipIf` pattern
  already supports it; only the workflow needs the `services:` block and env.
- A reviewer should confirm the workflow actually triggers on the PR (the checks
  appear) — a misnamed file under `.github/workflows/` silently does nothing.
