# Plan 005: Skip (don't fabricate "today") when a reel's upload date is missing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- pipeline/extract.ts pipeline/calls.ts`
> If either changed, compare the "Current state" excerpts against the live code;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 002 (touches the same `extract.ts` loop — sequence after 002 to avoid a merge conflict)
- **Category**: bug
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

In the Instagram extract path, `postDateOf` falls back to **today's date** when a
reel's yt-dlp `.info.json` is missing or has no `upload_date`. A reel with a
partial download then gets scored as if it were posted on extraction day —
every forward-return window (`1w`/`1m`/`3m`/`toDate`) is measured from the wrong
anchor, silently (no warning). A wrong post date is worse than a dropped call: it
produces plausible-but-fabricated accuracy numbers.

The fix: when the upload date can't be determined, **skip the call with a loud
warning** rather than inventing one — mirroring how the loop already skips on a
malformed classification.

## Current state

`pipeline/extract.ts`:

```ts
async function postDateOf(handle: string, code: string): Promise<string> {
  // yt-dlp info json: upload_date YYYYMMDD
  const dir = join(rawDir(handle), code);
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    if (j.upload_date) return `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}`;
  }
  return new Date().toISOString().slice(0, 10);   // <-- fabricated date
}

export async function extract(handle: string) {
  const { text } = await discoverModels();
  const out: ReelCall[] = [];
  for (const f of await readdir(transcriptsDir(handle))) {
    if (!f.endsWith(".json")) continue;
    const code = f.replace(".json", "");
    const tr = JSON.parse(await readFile(join(transcriptsDir(handle), f), "utf8"));
    const fp = join(framesDir(handle), f);
    const hints = existsSync(fp) ? JSON.parse(await readFile(fp, "utf8")).hints : [];
    const body = `TRANSCRIPT:\n${tr.text}\n\nON-SCREEN HINTS:\n${JSON.stringify(hints)}`;
    const c = await classify(text, body);
    if (!c) { console.warn(`skip ${code}: malformed extract response`); continue; }
    const rc = toReelCall(c, code, await postDateOf(handle, code));
    if (rc) out.push(rc);
  }
  await writeCalls(handle, out);
  return out;
}
```

- `readdir` on a missing `dir` throws — but `postDateOf` is called only for codes
  that have a transcript; the raw dir normally exists. Still, the `find` can
  return `undefined` (no `.info.json`), and `j.upload_date` can be absent — both
  currently hit the `new Date()` fallback.
- **If Plan 002 has landed**, the classify call site reads:
  `let c; try { c = await classify(...); } catch { ...; continue; } ... const rc = toReelCall(c, code, await postDateOf(...))`.
  Adapt to whichever form is live (check during the drift step). The change in
  this plan is independent of the classify-null handling.
- This is **IG-only**. The X path (`pipeline/x/extract-x.ts`) uses `tweetDate(t.createdAt)`,
  which is always present (a tweet always has `createdAt`). Do not change the X
  path.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bunx tsc --noEmit`              | exit 0              |
| Full      | `bun test`                       | all pass            |

(There is no `extract.test.ts` today; see Test plan.)

## Scope

**In scope**:
- `pipeline/extract.ts`
- `pipeline/extract.test.ts` (create — see Test plan)

**Out of scope** (do NOT touch):
- `pipeline/x/extract-x.ts` — X has a real date always.
- `pipeline/calls.ts` — `toReelCall` is fine.
- Committed datasets — do not regenerate.

## Git workflow

- Branch: `advisor/005-extract-skip-missing-date`
- Commit message: conventional commits (e.g.
  `fix(extract): skip reels with no upload_date instead of dating them today`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make `postDateOf` return `null` when the date is unknown

```ts
async function postDateOf(handle: string, code: string): Promise<string | null> {
  // yt-dlp info json: upload_date YYYYMMDD. Null when unknown — the caller skips
  // rather than fabricating a date (a wrong anchor silently corrupts every return).
  const dir = join(rawDir(handle), code);
  if (!existsSync(dir)) return null;
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    if (j.upload_date) return `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}`;
  }
  return null;
}
```

(`existsSync` is already imported at the top of `extract.ts`.)

### Step 2: Skip in the loop when the date is null

In the loop, resolve the date before building the call and skip loudly if null:

```ts
const postDate = await postDateOf(handle, code);
if (postDate == null) { console.warn(`skip ${code}: no upload_date in info.json`); continue; }
const rc = toReelCall(c, code, postDate);
if (rc) out.push(rc);
```

(Adapt the surrounding lines to the live form of the classify guard — see Current
state note about Plan 002.)

**Verify**: `bunx tsc --noEmit` → exit 0.

### Step 3: Extract `postDateOf` for testability (small refactor)

`postDateOf` reads the filesystem, which is awkward to unit-test. Split the pure
parsing from the IO so the date-formatting logic is testable without files:

```ts
// Pure: format a yt-dlp upload_date (YYYYMMDD) or return null. Exported for tests.
export function formatUploadDate(uploadDate: unknown): string | null {
  if (typeof uploadDate !== "string" || !/^\d{8}$/.test(uploadDate)) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}
```

Then `postDateOf` uses it:
```ts
if (info) {
  const j = JSON.parse(await readFile(join(dir, info), "utf8"));
  return formatUploadDate(j.upload_date);
}
return null;
```

This also tightens the format: a malformed `upload_date` (not 8 digits) now
yields `null` (skip) instead of a garbage sliced string.

**Verify**: `bunx tsc --noEmit` → exit 0.

## Test plan

Create `pipeline/extract.test.ts` (model the structure on
`pipeline/calls.test.ts` — `import { describe, it, expect } from "bun:test"`).
Test the pure `formatUploadDate`:

```ts
import { describe, it, expect } from "bun:test";
import { formatUploadDate } from "./extract";

describe("formatUploadDate", () => {
  it("formats a valid YYYYMMDD", () => {
    expect(formatUploadDate("20260601")).toBe("2026-06-01");
  });
  it("returns null for a missing date", () => {
    expect(formatUploadDate(undefined)).toBeNull();
  });
  it("returns null for a malformed date", () => {
    expect(formatUploadDate("2026-06")).toBeNull();
    expect(formatUploadDate("garbage")).toBeNull();
  });
});
```

Verification: `bun test pipeline/extract.test.ts` → all pass.

## Done criteria

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0; `pipeline/extract.test.ts` exists with `formatUploadDate` tests
- [ ] `grep -n "new Date().toISOString" pipeline/extract.ts` returns no matches (the fabricated-date fallback is gone)
- [ ] `postDateOf` returns `string | null`, and the loop skips with a warning on `null`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `extract.ts` excerpts don't match the live file (drift — possibly Plan 002
  reshaped the loop differently than noted; re-read before editing).
- `bun test` has a pre-existing failure before you start.

## Maintenance notes

- **Re-scoring is a separate operator step.** Skipping a reel removes it from
  *future* runs; committed datasets are unchanged until re-scored
  (`score` → `parity-check` → `PARITY OK`).
- A skipped reel is now visibly logged; an operator reviewing pipeline output can
  spot a creator with many `no upload_date` skips (a sign of a flaky scrape worth
  re-running) rather than seeing silently mis-dated calls.
- A reviewer should confirm the X path was not touched (it correctly always has a
  date).
