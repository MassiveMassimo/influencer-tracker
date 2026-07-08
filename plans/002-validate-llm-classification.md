# Plan 002: Validate LLM classification output and stop silently dropping calls on the X path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- pipeline/calls.ts pipeline/extract.ts pipeline/x/extract-x.ts pipeline/calls.test.ts pipeline/x/extract-x.test.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 001 (CI gate should be enforcing tests first)
- **Category**: bug
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

`classify()` (`pipeline/calls.ts`) sends untrusted scraped text to an LLM and
parses the JSON reply with **zero validation**: the reply envelope is cast
(`as { choices: ... }`) and the inner payload is cast (`as Classification`).
Two concrete failures result:

1. **Silent data loss at scale.** On the X path, when the model returns a
   provider-error body (no `choices`) or non-JSON content, `classify()` returns
   `null`. In `extractX`, a `null` classification makes `tweetToReelCall` return
   `null`, and the worker then **marks the tweet `done`** — indistinguishable
   from "genuinely not a stock call." The call is dropped forever, with no log.
   The IG path at least `console.warn`s; the X path (thousands of tweets) does
   not.
2. **Whole-dataset crash on a bad value.** No field is validated, so an
   out-of-range value (e.g. `conviction: 2`) flows through `toReelCall` into
   scoring, where `DatasetSchema.parse` (`pipeline/score.ts:40`) enforces
   `conviction` is `z.number().min(0).max(1)` (`src/lib/schema.ts:21`) and
   throws — failing the **entire** dataset assembly with no pointer to the
   offending call.

The fix: validate the LLM reply with a Zod schema, and make a _parse/validation
failure_ a thrown error (so the X heal-loop's existing retry catches it) while a
_genuine no-ticker classification_ stays a clean `null` that marks the tweet
done. This separates "we failed to read the model" from "the model said no
stock call."

## Current state

- `pipeline/calls.ts` — the classifier. Key excerpts:

  ```ts
  // lines 17-26: the target shape
  export interface Classification {
    ticker: string | null;
    company: string | null;
    direction: Direction; // "bullish" | "bearish" | "neutral"
    isExplicitBuy: boolean;
    conviction: number; // 0..1
    quote: string;
    onScreenPrice: number | null;
    summary: string;
  }

  // lines 33-51: the unvalidated parse
  export async function classify(
    textModel: string,
    body: string,
    client: ChatClient = groq,
  ): Promise<Classification | null> {
    const r = (await (
      await client("/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: textModel,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CLASSIFY_SYS },
            { role: "user", content: body },
          ],
        }),
      })
    ).json()) as { choices: { message: { content: string } }[] };
    try {
      return JSON.parse(r.choices[0].message.content) as Classification;
    } catch {
      return null;
    }
  }
  ```
  - `Direction` is imported from `../src/lib/types` (line 5): `"bullish" | "bearish" | "neutral"`.
  - `toReelCall(c, shortcode, postDate)` (lines 54-67) returns `null` only when
    `!c.ticker`. It already coerces fields defensively (`Number(c.conviction ?? 0)`,
    `c.direction ?? "neutral"`, etc.).

- `pipeline/extract.ts` (IG path) — single-threaded loop. The call site (lines 30-33):
  ```ts
  const c = await classify(text, body);
  if (!c) {
    console.warn(`skip ${code}: malformed extract response`);
    continue;
  }
  const rc = toReelCall(c, code, await postDateOf(handle, code));
  if (rc) out.push(rc);
  ```
  There is **no** try/catch around this loop body; a thrown error would abort the
  whole `extract()` run.
- `pipeline/x/extract-x.ts` (X path) — the relevant pieces:

  ```ts
  // lines 23-34: tweetToReelCall
  export async function tweetToReelCall(t: TweetRecord, handle: string, deps: ExtractDeps): Promise<ReelCall | null> {
    ...
    const c = await deps.classifyFn(deps.text, body);
    if (!c) return null;
    return toReelCall(c, t.id, tweetDate(t.createdAt));
  }

  // lines 85-94: the worker — note done.add happens on any non-throw
  const worker = async () => {
    while (next < pending.length) {
      const t = pending[next++];
      try {
        const rc = await tweetToReelCall(t, handle, deps);
        if (rc) out.push(rc);
        done.add(t.id);                                  // marks done even when rc == null
      } catch (e) {
        console.warn(`skip ${t.id}: ${(e as Error).message}`); // left un-done; retried next pass
      }
      ...
    }
  };
  ```

  The heal-loop (lines 78-108) re-runs any tweet **not** in `done`. So: throw ⇒
  retried; return-null ⇒ marked done. This is the lever the fix uses.

- `ExtractDeps.classifyFn` type (`pipeline/x/extract-x.ts:15`):
  `(textModel: string, body: string) => Promise<Classification | null>`.
- `zod` v4 is already a dependency (`package.json`). Existing Zod usage:
  `src/lib/schema.ts` (e.g. `z.number().min(0).max(1)`, `z.enum`, `z.array`).
- Existing tests:
  - `pipeline/calls.test.ts` tests `toReelCall` + `buildReview` only — **not**
    `classify` (it hits the network today).
  - `pipeline/x/extract-x.test.ts` injects `deps.classifyFn` and has a test
    `"returns null when classifier finds no call"` that passes `deps(null)`
    (classifyFn returns `null`). **This test's contract changes** — see Step 4.

## Commands you will need

| Purpose   | Command                                 | Expected on success |
| --------- | --------------------------------------- | ------------------- |
| Typecheck | `bunx tsc --noEmit`                     | exit 0              |
| Unit test | `bun test pipeline/calls.test.ts`       | all pass            |
| Unit test | `bun test pipeline/x/extract-x.test.ts` | all pass            |
| Full      | `bun test`                              | all pass            |

## Suggested executor toolkit

- Use `context7` docs for Zod v4 if unsure of `safeParse` / `z.enum` API.

## Scope

**In scope** (the only files you should modify):

- `pipeline/calls.ts`
- `pipeline/extract.ts`
- `pipeline/x/extract-x.ts`
- `pipeline/calls.test.ts`
- `pipeline/x/extract-x.test.ts`

**Out of scope** (do NOT touch):

- `src/lib/schema.ts` / `DatasetSchema` — the dataset schema is correct; the bug
  is upstream. Do not loosen `conviction`'s `min(0).max(1)`.
- `pipeline/groq.ts`, `pipeline/fireworks.ts` — the HTTP clients are fine.
- `pipeline/score.ts` — no change; it stays fail-closed by design.
- The committed `data/creators/*/dataset.json` and `reel-calls.json` — never
  regenerate data in this plan (no API keys, no network in CI). Re-scoring is an
  operator step, see Maintenance notes.
- Do NOT change the `CLASSIFY_SYS` prompt text (prompt-injection hardening is a
  separate, unselected finding).

## Git workflow

- Branch: `advisor/002-validate-classification`
- Commit message style: conventional commits (e.g.
  `fix(extract): validate LLM reply; route parse failures to retry`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a Zod schema for the classification payload in `pipeline/calls.ts`

Add an import and a schema near the top of `pipeline/calls.ts` (after the
existing imports). Use Zod and **derive nothing from the schema** for the
`Classification` interface — keep the interface as-is so other code is unchanged;
the schema is a runtime validator that produces the same shape.

```ts
import { z } from "zod";

// Runtime validation of the LLM reply payload. The model is instructed to emit
// exactly this shape (see CLASSIFY_SYS); coerce/clamp the few fields a model
// realistically gets slightly wrong rather than rejecting the whole call.
const ClassificationSchema = z.object({
  ticker: z.string().nullable().catch(null),
  company: z.string().nullable().catch(null),
  direction: z.enum(["bullish", "bearish", "neutral"]).catch("neutral"),
  isExplicitBuy: z.boolean().catch(false),
  conviction: z.number().min(0).max(1).catch(0),
  quote: z.string().catch(""),
  onScreenPrice: z.number().nullable().catch(null),
  summary: z.string().catch(""),
});
```

Notes:

- `.catch(...)` makes a _malformed individual field_ fall back to a safe default
  instead of failing — this is what prevents the `conviction: 2` →
  whole-dataset-crash failure mode (it clamps to a valid value). `conviction`
  above `1` fails `min/max` and falls to `0` via `.catch`. (If you prefer
  clamping to the boundary rather than `0`, use
  `z.number().catch(0).pipe(z.number().min(0).max(1).catch(0))` — but the simple
  form above is acceptable and the tests below assume it.)
- The schema does **not** decide "is this a call" — that's `ticker` being
  non-null, handled by the existing `toReelCall`.

**Verify**: `bunx tsc --noEmit` → exit 0.

### Step 2: Make `classify()` throw on an unreadable reply, validate on a readable one

Replace the body of `classify()` (lines 38-51 in the excerpt). New contract:
**throw** when the reply envelope is missing or the content is not JSON (a
transport/provider failure that should be retried); **return a validated
`Classification`** otherwise. The return type stays `Promise<Classification>`
(drop the `| null` — a clean "not a call" is still a valid `Classification` with
`ticker: null`).

```ts
export async function classify(
  textModel: string,
  body: string,
  client: ChatClient = groq,
): Promise<Classification> {
  const r = (await (
    await client("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: textModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFY_SYS },
          { role: "user", content: body },
        ],
      }),
    })
  ).json()) as { choices?: { message?: { content?: string } }[] };
  const content = r.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("classify: missing choices/content in LLM reply");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("classify: reply content was not valid JSON");
  }
  return ClassificationSchema.parse(raw);
}
```

Because every field in `ClassificationSchema` has a `.catch`, `.parse` will not
throw on a structurally-present-but-imperfect object; it only throws if `raw` is
not an object at all (e.g. JSON was `"true"` or a number) — which is itself an
unreadable reply worth retrying. That is acceptable.

**Verify**: `bunx tsc --noEmit` → exit 0 (note: this will surface a type error at
the `extract.ts` and `extract-x.ts` call sites because the return type changed —
those are fixed in Steps 3-4; you may see those two errors here and that's
expected).

### Step 3: Guard the IG `extract()` loop so a thrown classify doesn't abort the run

In `pipeline/extract.ts`, the loop body now must tolerate `classify` throwing
(low-volume path; a human reviews `calls.review.md` afterward, so logging + skip
is acceptable here — unlike X, there's no auto-retry loop). Replace lines 30-33:

```ts
let c;
try {
  c = await classify(text, body);
} catch (e) {
  console.warn(`skip ${code}: classify failed — ${(e as Error).message}`);
  continue;
}
const rc = toReelCall(c, code, await postDateOf(handle, code));
if (rc) out.push(rc);
```

The old `if (!c) { console.warn(...); continue; }` line is removed (classify no
longer returns null).

**Verify**: `bunx tsc --noEmit` → exit 0 for `pipeline/extract.ts` (the
`extract-x.ts` error remains until Step 4).

### Step 4: Update the X path contract and its test

In `pipeline/x/extract-x.ts`:

- Change `ExtractDeps.classifyFn` type (line 15) to
  `(textModel: string, body: string) => Promise<Classification>` (drop `| null`).
- In `tweetToReelCall` (lines 23-34), remove the `const c = ...; if (!c) return null;`
  null-guard. `classifyFn` either throws (→ propagates to the worker's `catch` →
  tweet left un-done → retried) or returns a `Classification`; `toReelCall`
  returns `null` only for a genuine no-ticker call (→ marked done, correct):
  ```ts
  const c = await deps.classifyFn(deps.text, body);
  return toReelCall(c, t.id, tweetDate(t.createdAt));
  ```
  Do **not** change the worker or heal-loop — they already do the right thing
  once `classify` throws on failure.

In `pipeline/x/extract-x.test.ts`:

- The `deps` helper (lines 5-9) types `c: Classification | null`. Change it to
  accept a `Classification` (and, for the throw case, a thrown error). Update the
  two tests:
  - `"maps a classified tweet to a ReelCall..."` — unchanged in intent; pass a
    valid `Classification`.
  - `"returns null when classifier finds no call"` — change so the classifier
    returns a `Classification` with `ticker: null` (the _real_ not-a-call
    signal), and expect `null`:
    ```ts
    it("returns null when the model finds no ticker", async () => {
      const rc = await tweetToReelCall(
        { id: "t2", createdAt: "2026-01-15T10:00:00.000Z", text: "gm", imageUrls: [] },
        "profinv",
        deps({
          ticker: null,
          company: null,
          direction: "neutral",
          isExplicitBuy: false,
          conviction: 0,
          quote: "",
          onScreenPrice: null,
          summary: "",
        }),
      );
      expect(rc).toBeNull();
    });
    ```

**Verify**:

- `bunx tsc --noEmit` → exit 0 (all call sites now match).
- `bun test pipeline/x/extract-x.test.ts` → all pass.

### Step 5: Add `classify` unit tests in `pipeline/calls.test.ts`

`classify` takes a `client` fn (`ChatClient = (path, init?) => Promise<Response>`)
— inject a fake to test without the network. Add a `describe("classify", ...)`
block (model it after the existing `describe` blocks; `import { classify } from "./calls"`).
Cover:

- **valid reply** → returns the parsed `Classification` (e.g. content
  `'{"ticker":"NBIS",...all fields...}'`) → `ticker === "NBIS"`.
- **out-of-range conviction** (`conviction: 2`) → does not throw; result
  `conviction === 0` (clamped via `.catch`).
- **missing `choices`** (reply body `{}`) → `classify(...)` **throws** (assert with
  `expect(classify(...)).rejects.toThrow()`).
- **non-JSON content** (content is `"not json"`) → throws.

Fake client shape:

```ts
const fakeClient = (bodyJson: unknown) =>
  (async () => new Response(JSON.stringify(bodyJson), { status: 200 })) as unknown as (
    path: string,
    init?: RequestInit,
  ) => Promise<Response>;
// valid: fakeClient({ choices: [{ message: { content: JSON.stringify({...}) } }] })
// missing choices: fakeClient({})
```

**Verify**: `bun test pipeline/calls.test.ts` → all pass (old + new).

## Test plan

- New tests in `pipeline/calls.test.ts`: `classify` valid / clamped / missing-choices
  (throws) / non-JSON (throws). Model after the existing `describe` blocks in the
  same file.
- Updated test in `pipeline/x/extract-x.test.ts`: not-a-call now signalled by
  `ticker: null` (not a `null` classification).
- Verification: `bun test` → all pass, including the 4 new `classify` cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0
- [ ] `classify` returns `Promise<Classification>` (no `| null`) and throws on missing-choices / non-JSON (covered by new tests)
- [ ] `grep -n "as Classification" pipeline/calls.ts` returns no matches (the unchecked cast is gone)
- [ ] `pipeline/x/extract-x.ts` `tweetToReelCall` no longer special-cases a `null` from `classifyFn`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `classify` body in `pipeline/calls.ts` doesn't match the "Current state"
  excerpt (drift — the parse may have already been changed).
- Making `classify` throw causes a cascade of type errors **outside** the four
  in-scope source files (some other caller depends on the `| null` return) —
  report the call sites rather than editing out-of-scope files.
- `bun test` has a pre-existing failure before you start (report it; that's
  Plan 001's concern, not this one).

## Maintenance notes

- **Re-scoring is a separate operator step, not part of this plan.** These
  changes affect _future_ extraction runs. The committed datasets were produced
  by the old path; they are not regenerated here. After this lands, an operator
  re-running `pipeline:x` / `pipeline` for a creator and then `score` will get
  the corrected behavior; that run must be followed by `bun run scripts/parity-check.ts`
  (must print `PARITY OK`) per CLAUDE.md.
- A reviewer should check that the `.catch` defaults in `ClassificationSchema`
  match the defensive defaults already in `toReelCall` (e.g. `direction` →
  `"neutral"`), so the two layers agree.
- If prompt-injection hardening (validating `quote` is a substring of the source
  text) is taken up later, it slots into `toReelCall` or a post-validation step
  here — note it was deliberately out of scope.
