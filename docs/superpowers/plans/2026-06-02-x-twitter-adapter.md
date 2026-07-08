# X/Twitter Ingestion Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an X/Twitter ingestion + extraction path that emits the same
`reel-calls.json` (`ReelCall[]`) the existing pipeline produces, so scoring and
the dashboard work unchanged for a text-first creator like @TheProfInvestor.

**Architecture:** Rettiwt-API fetches a user's original tweets over the last 12
months (text + date + id + image URLs) → images downloaded → a shared classifier
(lifted out of `extract.ts`) turns each tweet's text + image-vision hints into a
`ReelCall` → the unchanged `prices.ts`/`score.ts` build `dataset.json`. Shared
LLM logic is factored into `pipeline/calls.ts` and `pipeline/vision.ts` so IG and
X never diverge on "what counts as a call."

**Tech Stack:** Bun, TypeScript, Rettiwt-API, Groq (vision + text), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-x-twitter-adapter-design.md`

**Working directory:** all paths are relative to `influencer-tracker/`. Run all
commands from inside `influencer-tracker/`.

---

## File Structure

- Create `pipeline/retry.ts` — generic `withRetry` helper (Rettiwt rate limits).
- Create `pipeline/vision.ts` — `readImage` + `parseHint` (lifted from `frames.ts`).
- Create `pipeline/calls.ts` — `classify` + `toReelCall` + `buildReview` + `writeCalls` (lifted from `extract.ts`).
- Modify `pipeline/frames.ts` — use `pipeline/vision.ts`.
- Modify `pipeline/extract.ts` — use `pipeline/calls.ts`.
- Modify `pipeline/config.ts` — add `RETTIWT_KEY`.
- Create `pipeline/x/scrape-x.ts` — Rettiwt fetch + image download → `tweets.json` + `raw/shortcodes.json`.
- Create `pipeline/x/extract-x.ts` — tweet (+image hints) → `ReelCall` → `writeCalls`.
- Create `pipeline/run-x.ts` — orchestrator mirroring `run.ts`.
- Modify `package.json` — add `pipeline:x` script + `rettiwt-api` dep.
- Tests: `pipeline/retry.test.ts`, `pipeline/vision.test.ts`, `pipeline/calls.test.ts`, `pipeline/x/scrape-x.test.ts`, `pipeline/x/extract-x.test.ts`.

The shared-helper refactor (Tasks 2–3) is behavior-preserving: the IG pipeline
must still emit the identical `reel-calls.json` for the existing NBIS fixture.

---

## Task 1: Generic retry helper

**Files:**

- Create: `pipeline/retry.ts`
- Test: `pipeline/retry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/retry.test.ts
import { describe, it, expect } from "vitest";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return 42;
    });
    expect(r).toBe(42);
    expect(calls).toBe(1);
  });

  it("retries retryable errors then succeeds", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("rate limit");
        return "ok";
      },
      { retries: 5, delayMs: () => 0, isRetryable: (e) => String(e).includes("rate") },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  it("stops on non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("fatal");
        },
        { retries: 5, delayMs: () => 0, isRetryable: (e) => String(e).includes("rate") },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("gives up after retries exhausted", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("rate limit");
        },
        { retries: 2, delayMs: () => 0 },
      ),
    ).rejects.toThrow("rate limit");
    expect(calls).toBe(3); // initial + 2 retries
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run pipeline/retry.test.ts`
Expected: FAIL — cannot find module `./retry`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/retry.ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RetryOpts {
  retries?: number;
  isRetryable?: (e: unknown) => boolean;
  delayMs?: (attempt: number) => number; // attempt is 0-based
  label?: string;
}

// Retry an async fn with backoff. Default backoff is exponential capped at 30s.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const {
    retries = 5,
    isRetryable = () => true,
    delayMs = (a) => Math.min(2 ** a, 30) * 1000,
    label = "",
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const wait = delayMs(attempt);
      console.warn(
        `retry ${attempt + 1}/${retries}${label ? ` ${label}` : ""} in ${(wait / 1000).toFixed(1)}s`,
      );
      await sleep(wait);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run pipeline/retry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/retry.ts pipeline/retry.test.ts
git commit -m "feat: generic withRetry backoff helper"
```

---

## Task 2: Shared vision helper

**Files:**

- Create: `pipeline/vision.ts`
- Test: `pipeline/vision.test.ts`
- Modify: `pipeline/frames.ts`

- [ ] **Step 1: Write the failing test** (the pure parse is the testable unit)

````typescript
// pipeline/vision.test.ts
import { describe, it, expect } from "vitest";
import { parseHint } from "./vision";

describe("parseHint", () => {
  it("parses clean JSON", () => {
    expect(parseHint('{"ticker":"NBIS","price":65.1}')).toEqual({ ticker: "NBIS", price: 65.1 });
  });
  it("strips code fences", () => {
    expect(parseHint('```json\n{"ticker":"AAPL","price":null}\n```')).toEqual({
      ticker: "AAPL",
      price: null,
    });
  });
  it("falls back to nulls on garbage", () => {
    expect(parseHint("not json")).toEqual({ ticker: null, price: null });
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run pipeline/vision.test.ts`
Expected: FAIL — cannot find module `./vision`.

- [ ] **Step 3: Write minimal implementation**

````typescript
// pipeline/vision.ts
import { readFile } from "node:fs/promises";
import { groq } from "./groq";

export interface FrameHint {
  ticker: string | null;
  price: number | null;
}

const PROMPT =
  "This is a frame from a stock-picker's video or a chart image. Read any on-screen " +
  "stock ticker symbol and any displayed price. Reply as compact JSON: " +
  '{"ticker": string|null, "price": number|null}. No prose.';

// Parse the model's JSON reply, tolerating code fences and garbage.
export function parseHint(content: string): FrameHint {
  try {
    return JSON.parse(content.replace(/```json|```/g, "")) as FrameHint;
  } catch {
    return { ticker: null, price: null };
  }
}

// Run the vision model on a single image, returning the ticker/price hint.
export async function readImage(vision: string, imgPath: string): Promise<FrameHint> {
  const b64 = (await readFile(imgPath)).toString("base64");
  const body = {
    model: vision,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
    temperature: 0,
  };
  const r = (await (
    await groq("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json()) as { choices: { message: { content: string } }[] };
  return parseHint(r.choices[0].message.content);
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run pipeline/vision.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `frames.ts` to use the shared helper**

Replace the top of `pipeline/frames.ts` (imports + `PROMPT` + `FrameHint` +
`readFrame`) so it imports from `./vision` and drops the local copies. The
`frames()` function body stays the same except `readFrame(vision, img)` becomes
`readImage(vision, img)`.

```typescript
// pipeline/frames.ts — new header (replaces lines 1-33)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, framesDir } from "./config";
import { discoverModels } from "./groq";
import { readImage, type FrameHint } from "./vision";
```

In the `frames()` body, change the sampling line:

```typescript
if (existsSync(img)) hints.push(await readImage(vision, img));
```

(Note: `readFile` import is no longer needed in `frames.ts`; remove it.)

- [ ] **Step 6: Verify the IG fixture path still typechecks and tests pass**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc exit 0; all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add pipeline/vision.ts pipeline/vision.test.ts pipeline/frames.ts
git commit -m "refactor: lift frame vision into shared pipeline/vision.ts"
```

---

## Task 3: Shared call classifier

**Files:**

- Create: `pipeline/calls.ts`
- Test: `pipeline/calls.test.ts`
- Modify: `pipeline/extract.ts`

- [ ] **Step 1: Write the failing test** (pure mapping + review formatting)

```typescript
// pipeline/calls.test.ts
import { describe, it, expect } from "vitest";
import { toReelCall, buildReview, type Classification } from "./calls";

const base: Classification = {
  ticker: "nbis",
  company: "Nebius",
  direction: "bullish",
  isExplicitBuy: true,
  conviction: 0.8,
  quote: "load up on NBIS",
  onScreenPrice: 65.1,
};

describe("toReelCall", () => {
  it("uppercases ticker and maps fields", () => {
    const rc = toReelCall(base, "tweet123", "2026-01-15");
    expect(rc).toMatchObject({
      shortcode: "tweet123",
      postDate: "2026-01-15",
      ticker: "NBIS",
      company: "Nebius",
      direction: "bullish",
      isExplicitBuy: true,
      conviction: 0.8,
      quote: "load up on NBIS",
      onScreenPrice: 65.1,
    });
  });
  it("returns null when no ticker", () => {
    expect(toReelCall({ ...base, ticker: null }, "t", "2026-01-15")).toBeNull();
  });
  it("applies defaults for missing optional fields", () => {
    const rc = toReelCall({ ticker: "AAPL" } as Classification, "t", "2026-01-15");
    expect(rc).toMatchObject({
      company: "",
      direction: "neutral",
      isExplicitBuy: false,
      conviction: 0,
      quote: "",
      onScreenPrice: null,
    });
  });
});

describe("buildReview", () => {
  it("counts explicit bullish calls and renders rows", () => {
    const md = buildReview([
      toReelCall(base, "t1", "2026-01-15")!,
      toReelCall(
        { ...base, ticker: "AAPL", direction: "neutral", isExplicitBuy: false },
        "t2",
        "2026-02-01",
      )!,
    ]);
    expect(md).toContain("Explicit bullish calls: 1");
    expect(md).toContain("NBIS");
    expect(md).toContain("| date | ticker |");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run pipeline/calls.test.ts`
Expected: FAIL — cannot find module `./calls`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/calls.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { creatorDir } from "./config";
import { groq } from "./groq";
import type { Direction, ReelCall } from "../src/lib/types";

export const CLASSIFY_SYS =
  "You analyze a stock influencer's post (a video transcript or a tweet). Decide if it " +
  "makes an EXPLICIT BULLISH call (names a ticker AND tells viewers to buy/hold it). Use " +
  "the provided text and on-screen/image hints (the hints are authoritative for the exact " +
  "ticker symbol). " +
  'Reply ONLY JSON: {"ticker":string|null,"company":string|null,"direction":"bullish"|"bearish"|"neutral",' +
  '"isExplicitBuy":boolean,"conviction":number,"quote":string,"onScreenPrice":number|null}. ' +
  "ticker null if no specific stock. conviction 0..1.";

export interface Classification {
  ticker: string | null;
  company: string | null;
  direction: Direction;
  isExplicitBuy: boolean;
  conviction: number;
  quote: string;
  onScreenPrice: number | null;
}

// One LLM classification call. Returns null on malformed JSON (caller skips).
export async function classify(textModel: string, body: string): Promise<Classification | null> {
  const r = (await (
    await groq("/chat/completions", {
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

// Normalize a classification into a ReelCall. Null if no ticker (not a stock call).
export function toReelCall(
  c: Classification,
  shortcode: string,
  postDate: string,
): ReelCall | null {
  if (!c.ticker) return null;
  return {
    shortcode,
    postDate,
    ticker: String(c.ticker).toUpperCase(),
    company: c.company ?? "",
    direction: c.direction ?? "neutral",
    isExplicitBuy: !!c.isExplicitBuy,
    conviction: Number(c.conviction ?? 0),
    quote: c.quote ?? "",
    onScreenPrice: c.onScreenPrice ?? null,
  };
}

// Markdown review table the human checks before pricing/scoring.
export function buildReview(calls: ReelCall[]): string {
  const bullish = calls.filter((c) => c.isExplicitBuy && c.direction === "bullish");
  return [
    "# Calls review — verify before scoring",
    "",
    `Total posts with a ticker: ${calls.length}. Explicit bullish calls: ${bullish.length}.`,
    "",
    "| date | ticker | buy? | dir | conv | quote |",
    "|---|---|---|---|---|---|",
    ...[...calls]
      .sort((a, b) => a.postDate.localeCompare(b.postDate))
      .map(
        (c) =>
          `| ${c.postDate} | ${c.ticker} | ${c.isExplicitBuy ? "✅" : ""} | ${c.direction} | ${c.conviction} | ${c.quote.replace(/\|/g, " ").slice(0, 60)} |`,
      ),
  ].join("\n");
}

// Write the intermediate dataset both scoring and the human review consume.
export async function writeCalls(handle: string, calls: ReelCall[]): Promise<void> {
  await writeFile(join(creatorDir(handle), "reel-calls.json"), JSON.stringify(calls, null, 2));
  await writeFile(join(creatorDir(handle), "calls.review.md"), buildReview(calls));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run pipeline/calls.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor `extract.ts` to use the shared classifier**

Rewrite `pipeline/extract.ts` so it keeps only its IG-specific glue
(`postDateOf`, reading transcripts + frames) and delegates classification,
normalization, and writing to `pipeline/calls.ts`. Full new file:

```typescript
// pipeline/extract.ts
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { transcriptsDir, framesDir, rawDir } from "./config";
import { discoverModels } from "./groq";
import { classify, toReelCall, writeCalls } from "./calls";
import type { ReelCall } from "../src/lib/types";

async function postDateOf(handle: string, code: string): Promise<string> {
  // yt-dlp info json: upload_date YYYYMMDD
  const dir = join(rawDir(handle), code);
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    if (j.upload_date)
      return `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}`;
  }
  return new Date().toISOString().slice(0, 10);
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
    if (!c) {
      console.warn(`skip ${code}: malformed extract response`);
      continue;
    }
    const rc = toReelCall(c, code, await postDateOf(handle, code));
    if (rc) out.push(rc);
  }
  await writeCalls(handle, out);
  return out;
}
```

- [ ] **Step 6: Verify behavior preserved**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc exit 0; all tests pass. (The extract output shape is unchanged:
same `reel-calls.json` and `calls.review.md`.)

- [ ] **Step 7: Commit**

```bash
git add pipeline/calls.ts pipeline/calls.test.ts pipeline/extract.ts
git commit -m "refactor: lift call classification into shared pipeline/calls.ts"
```

---

## Task 4: Config — Rettiwt key

**Files:**

- Modify: `pipeline/config.ts`

- [ ] **Step 1: Add the lazy key constant**

Append to `pipeline/config.ts`:

```typescript
export const RETTIWT_KEY = process.env.RETTIWT_API_KEY ?? "";
```

(Guarded at use-site in `scrape-x.ts`, matching how `groq.ts` guards `GROQ_KEY`.)

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add pipeline/config.ts
git commit -m "feat: add RETTIWT_KEY env constant"
```

---

## Task 5: Install Rettiwt-API

**Files:**

- Modify: `package.json`, `bun.lock`

- [ ] **Step 1: Install**

Run: `bun add rettiwt-api`
Expected: adds `rettiwt-api` to dependencies.

- [ ] **Step 2: Typecheck (confirms types resolve)**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "build: add rettiwt-api dependency"
```

---

## Task 6: X scraper

**Files:**

- Create: `pipeline/x/scrape-x.ts`
- Test: `pipeline/x/scrape-x.test.ts`

- [ ] **Step 1: Write the failing test** (the pure tweet→record mapping)

```typescript
// pipeline/x/scrape-x.test.ts
import { describe, it, expect } from "vitest";
import { toRecord, isRateLimit } from "./scrape-x";

describe("toRecord", () => {
  it("maps id, text, ISO date, and photo URLs", () => {
    const rec = toRecord({
      id: 123,
      fullText: "buy NBIS",
      createdAt: "2026-01-15T10:00:00.000Z",
      media: [
        { type: "photo", url: "https://x/a.jpg" },
        { type: "video", url: "https://x/v.mp4" },
      ],
    });
    expect(rec).toEqual({
      id: "123",
      text: "buy NBIS",
      createdAt: "2026-01-15T10:00:00.000Z",
      imageUrls: ["https://x/a.jpg"],
    });
  });
  it("handles missing media and text", () => {
    const rec = toRecord({ id: 9, createdAt: "2026-01-15T00:00:00.000Z" });
    expect(rec).toEqual({
      id: "9",
      text: "",
      createdAt: "2026-01-15T00:00:00.000Z",
      imageUrls: [],
    });
  });
});

describe("isRateLimit", () => {
  it("detects rate-limit errors", () => {
    expect(isRateLimit(new Error("Too many requests (429)"))).toBe(true);
    expect(isRateLimit(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimit(new Error("not found"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run pipeline/x/scrape-x.test.ts`
Expected: FAIL — cannot find module `./scrape-x`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/x/scrape-x.ts
import { Rettiwt } from "rettiwt-api";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, RETTIWT_KEY } from "../config";
import { withRetry } from "../retry";

export interface TweetRecord {
  id: string;
  createdAt: string; // ISO
  text: string;
  imageUrls: string[];
}

const PHOTO = (m: any) =>
  m?.type === "photo" || m?.type === "image" || /\.(jpe?g|png)/i.test(m?.url ?? "");

// Pure: map a Rettiwt tweet to our record, keeping only image media.
export function toRecord(t: any): TweetRecord {
  const imageUrls = (t.media ?? [])
    .filter(PHOTO)
    .map((m: any) => m.url)
    .filter(Boolean);
  return {
    id: String(t.id),
    createdAt: new Date(t.createdAt).toISOString(),
    text: t.fullText ?? "",
    imageUrls,
  };
}

export function isRateLimit(e: unknown): boolean {
  return /rate.?limit|too many|429/i.test(String((e as Error)?.message ?? e));
}

async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await withRetry(() => fetch(url), {
    label: "img",
    isRetryable: isRateLimit,
    delayMs: () => 2000,
  });
  if (!res.ok) return;
  await mkdir(join(dest, ".."), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// Fetch a creator's original tweets over the last `months` and download images.
// X caps a user's reachable history near ~3,200 tweets; we log if truncated.
export async function scrapeX(handle: string, months = 12): Promise<TweetRecord[]> {
  if (!RETTIWT_KEY) throw new Error("RETTIWT_API_KEY not set (use a throwaway X account key)");
  const rettiwt = new Rettiwt({ apiKey: RETTIWT_KEY });
  const user = handle.replace(/^@/, "");
  const cutoff = new Date(Date.now() - months * 30 * 86400_000);
  const filter = { fromUsers: [user], onlyOriginal: true, startDate: cutoff, endDate: new Date() };

  const records: TweetRecord[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < 250; page++) {
    const data: any = await withRetry(() => rettiwt.tweet.search(filter as any, 20, cursor), {
      label: "x.search",
      isRetryable: isRateLimit,
      delayMs: (a) => Math.min(2 ** a, 30) * 1000,
    });
    records.push(...(data.list ?? []).map(toRecord));
    if (!data.next || !data.list?.length) break;
    cursor = data.next;
    if (records.length >= 3200) {
      truncated = true;
      break;
    }
  }

  await mkdir(rawDir(handle), { recursive: true });
  for (const r of records) {
    for (let i = 0; i < r.imageUrls.length; i++) {
      try {
        await downloadImage(r.imageUrls[i], join(rawDir(handle), r.id, `img_${i}.jpg`));
      } catch (e) {
        console.warn(`img fail ${r.id}: ${(e as Error).message}`);
      }
    }
  }
  await writeFile(join(rawDir(handle), "tweets.json"), JSON.stringify(records, null, 2));
  // Parity with the IG path: score.ts reads shortcodes.json for the scraped count.
  await writeFile(
    join(rawDir(handle), "shortcodes.json"),
    JSON.stringify(
      records.map((r) => r.id),
      null,
      2,
    ),
  );
  if (truncated)
    console.warn(`COVERAGE: hit ~3200-tweet ceiling for @${user}; older tweets may be missing`);
  console.log(`scraped ${records.length} tweets for @${user}`);
  return records;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run pipeline/x/scrape-x.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add pipeline/x/scrape-x.ts pipeline/x/scrape-x.test.ts
git commit -m "feat: X tweet scraper via Rettiwt-API"
```

---

## Task 7: X extractor

**Files:**

- Create: `pipeline/x/extract-x.ts`
- Test: `pipeline/x/extract-x.test.ts`

- [ ] **Step 1: Write the failing test** (date mapping + DI-mocked assembly)

```typescript
// pipeline/x/extract-x.test.ts
import { describe, it, expect } from "vitest";
import { tweetDate, tweetToReelCall, type ExtractDeps } from "./extract-x";
import type { Classification } from "../calls";

const deps = (c: Classification | null): ExtractDeps => ({
  text: "text-model",
  vision: "vision-model",
  classifyFn: async () => c,
  readImageFn: async () => ({ ticker: null, price: null }),
});

describe("tweetDate", () => {
  it("formats ISO to YYYY-MM-DD", () => {
    expect(tweetDate("2026-01-15T10:30:00.000Z")).toBe("2026-01-15");
  });
});

describe("tweetToReelCall", () => {
  it("maps a classified tweet to a ReelCall with tweet id + date", async () => {
    const rc = await tweetToReelCall(
      { id: "t1", createdAt: "2026-01-15T10:00:00.000Z", text: "buy NBIS", imageUrls: [] },
      "profinv",
      deps({
        ticker: "nbis",
        company: "Nebius",
        direction: "bullish",
        isExplicitBuy: true,
        conviction: 0.7,
        quote: "buy NBIS",
        onScreenPrice: null,
      }),
    );
    expect(rc).toMatchObject({
      shortcode: "t1",
      postDate: "2026-01-15",
      ticker: "NBIS",
      isExplicitBuy: true,
    });
  });
  it("returns null when classifier finds no call", async () => {
    const rc = await tweetToReelCall(
      { id: "t2", createdAt: "2026-01-15T10:00:00.000Z", text: "gm", imageUrls: [] },
      "profinv",
      deps(null),
    );
    expect(rc).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run pipeline/x/extract-x.test.ts`
Expected: FAIL — cannot find module `./extract-x`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/x/extract-x.ts
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir } from "../config";
import { discoverModels } from "../groq";
import { classify, toReelCall, writeCalls, type Classification } from "../calls";
import { readImage, type FrameHint } from "../vision";
import type { TweetRecord } from "./scrape-x";
import type { ReelCall } from "../../src/lib/types";

// Injected so the assembly can be unit-tested without hitting the network.
export interface ExtractDeps {
  text: string;
  vision: string;
  classifyFn: (textModel: string, body: string) => Promise<Classification | null>;
  readImageFn: (vision: string, imgPath: string) => Promise<FrameHint>;
}

export function tweetDate(createdAt: string): string {
  return new Date(createdAt).toISOString().slice(0, 10);
}

export async function tweetToReelCall(
  t: TweetRecord,
  handle: string,
  deps: ExtractDeps,
): Promise<ReelCall | null> {
  const hints: FrameHint[] = [];
  const dir = join(rawDir(handle), t.id);
  if (existsSync(dir)) {
    for (const f of await readdir(dir)) {
      if (/\.(jpe?g|png)$/i.test(f)) hints.push(await deps.readImageFn(deps.vision, join(dir, f)));
    }
  }
  const body = `TWEET:\n${t.text}\n\nIMAGE HINTS:\n${JSON.stringify(hints)}`;
  const c = await deps.classifyFn(deps.text, body);
  if (!c) return null;
  return toReelCall(c, t.id, tweetDate(t.createdAt));
}

export async function extractX(handle: string) {
  const { text, vision } = await discoverModels();
  const deps: ExtractDeps = { text, vision, classifyFn: classify, readImageFn: readImage };
  const tweets: TweetRecord[] = JSON.parse(
    await readFile(join(rawDir(handle), "tweets.json"), "utf8"),
  );
  const out: ReelCall[] = [];
  for (const t of tweets) {
    try {
      const rc = await tweetToReelCall(t, handle, deps);
      if (rc) out.push(rc);
    } catch (e) {
      console.warn(`skip ${t.id}: ${(e as Error).message}`);
    }
  }
  await writeCalls(handle, out);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run pipeline/x/extract-x.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add pipeline/x/extract-x.ts pipeline/x/extract-x.test.ts
git commit -m "feat: X extractor — tweet + image hints to ReelCall"
```

---

## Task 8: X orchestrator + script

**Files:**

- Create: `pipeline/run-x.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the orchestrator** (mirrors `pipeline/run.ts`)

```typescript
// pipeline/run-x.ts
import { scrapeX } from "./x/scrape-x";
import { extractX } from "./x/extract-x";
import { prices } from "./prices";
import { score } from "./score";

// Usage: bun run pipeline:x --handle TheProfInvestor --name "The Prof Investor" [--from <stage>]
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const handle = args.handle;
const name = args.name ?? handle;
if (!handle) throw new Error("--handle required");

const stages = ["scrape", "extract", "prices", "score"];
const start = args.from ? stages.indexOf(args.from) : 0;

for (const stage of stages.slice(start)) {
  console.log(`\n=== ${stage} ===`);
  if (stage === "scrape") {
    await scrapeX(handle);
  } else if (stage === "extract") {
    await extractX(handle);
    console.log("PAUSE: review calls.review.md then re-run with --from prices");
    break;
  } else if (stage === "prices") {
    await prices(handle);
  } else if (stage === "score") {
    await score(handle, name);
  }
}
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add after the `pipeline` entry:

```json
    "pipeline:x": "bun run pipeline/run-x.ts",
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Full test + typecheck sweep**

Run: `bunx vitest run && bunx tsc --noEmit`
Expected: all tests pass (existing 11 + retry 4 + vision 3 + calls 5 + scrape-x 5 + extract-x 3), tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add pipeline/run-x.ts package.json
git commit -m "feat: X pipeline orchestrator (pipeline:x)"
```

---

## Final verification

- [ ] `bunx vitest run` — all tests green.
- [ ] `bunx tsc --noEmit` — exit 0.
- [ ] The IG pipeline still produces the same `reel-calls.json` shape (Tasks 2–3 are behavior-preserving refactors; the existing NBIS fixture is the witness).
- [ ] Manual integration (deferred, needs key): with `RETTIWT_API_KEY` set to a throwaway-account key, `bun run pipeline:x --handle TheProfInvestor --name "The Prof Investor"` scrapes → extracts → pauses at `calls.review.md`; after review, `--from prices` finishes and the creator appears in the dashboard sidebar.

```

```
