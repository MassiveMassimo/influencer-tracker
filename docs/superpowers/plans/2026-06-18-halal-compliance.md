# Halal Compliance Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in halal-compliance badge (and Musaffa preview card) to tracked tickers, fed live from Musaffa's Typesense backend through a fail-open server function.

**Architecture:** A server function (`fetchHalal`) ports the Musaffa Typesense lookup to TypeScript, keyed server-side. A TanStack Query hook (`useHalalStatus`) caches it client-side (12h) and is enabled only when the `showHalalStatus` preference is on. Badge + preview-card components render per symbol wherever symbols appear. Display-only: no pipeline, DB, scoring, or parity changes.

**Tech Stack:** TanStack Start (`createServerFn`), TanStack Query, Base UI (coss `preview-card`), bklit `Gauge` (vendored), Iconify (`hugeicons:halal`), lucide (`CircleQuestionMark`), Zod, `bun test`.

## Global Constraints

- **Worktree only:** all work on branch `halal-compliance` in `/Users/imo/Documents/GitHub/influencer-tracker-halal-compliance`. Build/typecheck/`bun test` here; visual verification on `main` after merge.
- **Display-only:** never touch `pipeline/`, `db/`, `score`, `dataset.json`, prices, or the parity gate.
- **Fail-open everywhere:** any Musaffa error, missing key, or unmatched symbol → `status: "unknown"` → nothing renders. The feature can never break a page.
- **Do NOT use `resolveSymbol` for Musaffa lookups** — it canonicalizes toward Yahoo (`BRK-B`, `BTC-USD`, `HEIA.AS`). Musaffa keys by US ticker with a dot for class shares (`BRK.B`). Use `musaffaKey`.
- **Gauge `centerValue` is multiplied by 100 by `style:"percent"`** — pass the fraction (`halalPct/100`), never the raw 0–100 number.
- **Never read `localStorage` during render** (hydration #418). The toggle hydrates in a mount effect; SSR + first client render show nothing.
- **`#/` alias maps to `src/`.** Typecheck with `bunx tsc --noEmit`. Tests import `bun:test`.
- **`MUSAFFA_API_KEY`** is a 32-char Typesense search-only key, server-side only. Source value from the VM `stock-pipeline-v2/.env`.
- Musaffa endpoint: `GET https://0bs2hegi5nmtad4op.a1.typesense.net/collections/stocks_data/documents/search`, header `x-typesense-api-key`, filter `id:=[\`AAPL\`,...]`, `per_page=250`.

---

## File Structure

- `src/lib/halal/types.ts` — **create.** Isomorphic types + pure helpers (`parseRating`, `musaffaKey`, `musaffaUrl`, `badgeKindFor`, `purityFraction`, `UNKNOWN_INFO`). Client-safe (no network).
- `src/lib/halal/types.test.ts` — **create.** Unit tests for the pure helpers.
- `src/lib/halal/musaffa.ts` — **create.** Server-only `fetchMusaffa(keys, apiKey)` Typesense fetch.
- `src/lib/halal/musaffa.test.ts` — **create.** `fetchMusaffa` with mocked global `fetch`.
- `src/lib/halal-fetch.ts` — **create.** `fetchHalal` server fn + `assembleHalal` + cache helpers.
- `src/lib/halal-fetch.test.ts` — **create.** `assembleHalal`, cache, fail-open.
- `src/lib/halal-query.ts` — **create.** `halalQuery` + `useHalalStatus`.
- `src/lib/preferences.tsx` — **modify.** Add `showHalalStatus`.
- `src/lib/preferences.test.ts` — **modify.** Cover the new pref.
- `src/components/Preferences.tsx` — **modify.** Add the toggle row.
- `src/components/ui/preview-card.tsx` — **create** (via shadcn add).
- `src/components/halal/halal-card-content.tsx` — **create.** Presentational card body (rating + gauge + breakdown + Musaffa link).
- `src/components/halal/halal-badge.tsx` — **create.** `HalalBadge` (icon) + `HalalIndicator` (badge + preview card).
- `src/routes/t.$symbol.tsx`, `src/routes/explore.tsx`, `src/routes/c.$handle.index.tsx`, `src/routes/c.$handle.ticker.$symbol.tsx` — **modify.** Wire badges + inline card.
- `.env.example`, `CLAUDE.md` — **modify.** Document the key + feature.

---

## Task 1: Pure halal helpers + types

**Files:**

- Create: `src/lib/halal/types.ts`
- Test: `src/lib/halal/types.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type HalalStatus = "halal" | "doubtful" | "not_halal" | "unknown"`
  - `interface HalalInfo { status: HalalStatus; halalPct: number; notHalalPct: number; doubtfulPct: number; exchange: string; ticker: string; musaffaUrl: string }`
  - `const UNKNOWN_INFO: HalalInfo`
  - `parseRating(raw: string | undefined): HalalStatus`
  - `musaffaKey(symbol: string): string`
  - `musaffaUrl(ticker: string, exchange: string): string`
  - `badgeKindFor(status: HalalStatus): "halal" | "doubtful" | null`
  - `purityFraction(halalPct: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/halal/types.test.ts
import { describe, expect, it } from "bun:test";
import {
  parseRating,
  musaffaKey,
  musaffaUrl,
  badgeKindFor,
  purityFraction,
  UNKNOWN_INFO,
} from "./types.ts";

describe("parseRating", () => {
  it("maps known ratings", () => {
    expect(parseRating("COMPLIANT")).toBe("halal");
    expect(parseRating("NON_COMPLIANT")).toBe("not_halal");
    expect(parseRating("NOT_COMPLIANT")).toBe("not_halal");
    expect(parseRating("QUESTIONABLE")).toBe("doubtful");
    expect(parseRating("DOUBTFUL")).toBe("doubtful");
  });
  it("is case-insensitive", () => {
    expect(parseRating("compliant")).toBe("halal");
  });
  it("falls back to unknown", () => {
    expect(parseRating("")).toBe("unknown");
    expect(parseRating(undefined)).toBe("unknown");
    expect(parseRating("WHATEVER")).toBe("unknown");
  });
});

describe("musaffaKey", () => {
  it("uppercases and strips $", () => {
    expect(musaffaKey("aapl")).toBe("AAPL");
    expect(musaffaKey("$nvda")).toBe("NVDA");
  });
  it("converts class-share dash to dot (Yahoo BRK-B -> Musaffa BRK.B)", () => {
    expect(musaffaKey("BRK-B")).toBe("BRK.B");
    expect(musaffaKey("BF-B")).toBe("BF.B");
  });
  it("passes crypto / foreign through unchanged (they won't match Musaffa)", () => {
    expect(musaffaKey("BTC-USD")).toBe("BTC-USD");
    expect(musaffaKey("HEIA.AS")).toBe("HEIA.AS");
  });
});

describe("musaffaUrl", () => {
  it("builds the stock page URL", () => {
    expect(musaffaUrl("AAPL", "NASDAQ")).toBe("https://musaffa.com/stock/AAPL/NASDAQ");
  });
});

describe("badgeKindFor", () => {
  it("returns a kind only for halal/doubtful", () => {
    expect(badgeKindFor("halal")).toBe("halal");
    expect(badgeKindFor("doubtful")).toBe("doubtful");
    expect(badgeKindFor("not_halal")).toBeNull();
    expect(badgeKindFor("unknown")).toBeNull();
  });
});

describe("purityFraction", () => {
  it("converts 0-100 percent to a 0-1 fraction (gauge percent style x100)", () => {
    expect(purityFraction(95)).toBeCloseTo(0.95);
    expect(purityFraction(0)).toBe(0);
  });
});

describe("UNKNOWN_INFO", () => {
  it("is an unknown record with empty fields", () => {
    expect(UNKNOWN_INFO.status).toBe("unknown");
    expect(UNKNOWN_INFO.musaffaUrl).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/halal/types.test.ts`
Expected: FAIL — `Cannot find module './types.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/halal/types.ts
// Pure, isomorphic halal-compliance helpers + types. No network, client-safe.

export type HalalStatus = "halal" | "doubtful" | "not_halal" | "unknown";

export interface HalalInfo {
  status: HalalStatus;
  halalPct: number;
  notHalalPct: number;
  doubtfulPct: number;
  exchange: string;
  ticker: string;
  musaffaUrl: string;
}

export const UNKNOWN_INFO: HalalInfo = {
  status: "unknown",
  halalPct: 0,
  notHalalPct: 0,
  doubtfulPct: 0,
  exchange: "",
  ticker: "",
  musaffaUrl: "",
};

const RATING_MAP: Record<string, HalalStatus> = {
  COMPLIANT: "halal",
  HALAL: "halal",
  NON_COMPLIANT: "not_halal",
  NOT_COMPLIANT: "not_halal",
  NOT_HALAL: "not_halal",
  QUESTIONABLE: "doubtful",
  DOUBTFUL: "doubtful",
};

export function parseRating(raw: string | undefined): HalalStatus {
  if (!raw) return "unknown";
  return RATING_MAP[raw.trim().toUpperCase()] ?? "unknown";
}

// Derive the Musaffa Typesense `id` key from an app/Yahoo-canonical symbol.
// Musaffa keys by US ticker and uses a dot for class shares (BRK.B). Do NOT run
// resolveSymbol here — it rewrites toward Yahoo notation and would break matches.
export function musaffaKey(symbol: string): string {
  const s = symbol.trim().replace(/^\$/, "").toUpperCase();
  // Class shares: Yahoo "BRK-B" -> Musaffa "BRK.B". Single trailing letter only,
  // so "BTC-USD" (crypto) is left alone and falls through to unknown.
  return s.replace(/^([A-Z]+)-([A-Z])$/, "$1.$2");
}

export function musaffaUrl(ticker: string, exchange: string): string {
  return `https://musaffa.com/stock/${ticker}/${exchange}`;
}

export function badgeKindFor(status: HalalStatus): "halal" | "doubtful" | null {
  if (status === "halal") return "halal";
  if (status === "doubtful") return "doubtful";
  return null;
}

// Gauge centerValue is formatted by Intl.NumberFormat; style:"percent" multiplies
// by 100, so feed it the 0-1 fraction, not the raw 0-100 percent.
export function purityFraction(halalPct: number): number {
  return halalPct / 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/halal/types.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/halal/types.ts src/lib/halal/types.test.ts
git commit -m "feat(halal): pure status/key/url helpers + types"
```

---

## Task 2: Musaffa Typesense fetch

**Files:**

- Create: `src/lib/halal/musaffa.ts`
- Test: `src/lib/halal/musaffa.test.ts`

**Interfaces:**

- Consumes: `HalalInfo`, `parseRating`, `musaffaUrl` (Task 1).
- Produces:
  - `class MusaffaOutage extends Error`
  - `fetchMusaffa(keys: string[], apiKey: string): Promise<Record<string, HalalInfo>>` — keyed by the uppercased Musaffa `id`. Batches at 250. Throws `MusaffaOutage` on HTTP 5xx.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/halal/musaffa.test.ts
import { describe, expect, it, afterEach } from "bun:test";
import { fetchMusaffa, MusaffaOutage } from "./musaffa.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

describe("fetchMusaffa", () => {
  it("parses hits into HalalInfo keyed by id", async () => {
    mockFetch(200, {
      hits: [
        {
          document: {
            id: "AAPL",
            musaffaHalalRating: "COMPLIANT",
            halal_revenue_percent: 95.92,
            nothalal_revenue_percent: 4.08,
            doubtful_revenue_percent: 0,
            exchange: "NASDAQ",
            ticker: "AAPL",
          },
        },
      ],
    });
    const out = await fetchMusaffa(["AAPL"], "key");
    expect(out.AAPL.status).toBe("halal");
    expect(out.AAPL.halalPct).toBeCloseTo(95.92);
    expect(out.AAPL.musaffaUrl).toBe("https://musaffa.com/stock/AAPL/NASDAQ");
  });

  it("throws MusaffaOutage on 5xx", async () => {
    mockFetch(503, { message: "down" });
    expect(fetchMusaffa(["AAPL"], "key")).rejects.toBeInstanceOf(MusaffaOutage);
  });

  it("returns empty map for no keys without fetching", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    expect(await fetchMusaffa([], "key")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/halal/musaffa.test.ts`
Expected: FAIL — `Cannot find module './musaffa.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/halal/musaffa.ts
// Server-only: queries Musaffa's Typesense `stocks_data` collection. Keep out of
// the client bundle (only halal-fetch's server fn imports this).
import { type HalalInfo, parseRating, musaffaUrl } from "./types.ts";

const HOST = "https://0bs2hegi5nmtad4op.a1.typesense.net";
const SEARCH_PATH = "/collections/stocks_data/documents/search";
const MAX_PER_PAGE = 250;
const REQUEST_TIMEOUT_MS = 15_000;

export class MusaffaOutage extends Error {}

interface TypesenseDoc {
  id?: string;
  ticker?: string;
  musaffaHalalRating?: string;
  sharia_compliance?: string;
  halal_revenue_percent?: number;
  nothalal_revenue_percent?: number;
  doubtful_revenue_percent?: number;
  exchange?: string;
}

function toInfo(doc: TypesenseDoc): HalalInfo {
  const ticker = (doc.id ?? doc.ticker ?? "").toUpperCase();
  const exchange = doc.exchange ?? "";
  return {
    status: parseRating(doc.musaffaHalalRating ?? doc.sharia_compliance),
    halalPct: doc.halal_revenue_percent ?? 0,
    notHalalPct: doc.nothalal_revenue_percent ?? 0,
    doubtfulPct: doc.doubtful_revenue_percent ?? 0,
    exchange,
    ticker,
    musaffaUrl: ticker && exchange ? musaffaUrl(ticker, exchange) : "",
  };
}

async function searchBatch(keys: string[], apiKey: string): Promise<Record<string, HalalInfo>> {
  const filter = keys.map((k) => `\`${k}\``).join(",");
  const params = new URLSearchParams({
    q: "*",
    filter_by: `id:=[${filter}]`,
    per_page: String(MAX_PER_PAGE),
  });
  const res = await fetch(`${HOST}${SEARCH_PATH}?${params}`, {
    headers: { "x-typesense-api-key": apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status >= 500) {
    throw new MusaffaOutage(`Musaffa ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`Musaffa ${res.status}`);
  }
  const data = (await res.json()) as { hits?: { document?: TypesenseDoc }[] };
  const out: Record<string, HalalInfo> = {};
  for (const hit of data.hits ?? []) {
    const doc = hit.document;
    if (!doc) continue;
    const info = toInfo(doc);
    if (info.ticker) out[info.ticker] = info;
  }
  return out;
}

// Returns a map keyed by uppercased Musaffa `id`. Throws MusaffaOutage on 5xx so
// the caller (halal-fetch) can fail open. Missing keys simply aren't in the map.
export async function fetchMusaffa(
  keys: string[],
  apiKey: string,
): Promise<Record<string, HalalInfo>> {
  if (keys.length === 0) return {};
  const merged: Record<string, HalalInfo> = {};
  for (let i = 0; i < keys.length; i += MAX_PER_PAGE) {
    const chunk = keys.slice(i, i + MAX_PER_PAGE);
    Object.assign(merged, await searchBatch(chunk, apiKey));
  }
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/halal/musaffa.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/halal/musaffa.ts src/lib/halal/musaffa.test.ts
git commit -m "feat(halal): Musaffa Typesense fetch (port of musaffa_client.py)"
```

---

## Task 3: `fetchHalal` server fn + cache + assemble

**Files:**

- Create: `src/lib/halal-fetch.ts`
- Test: `src/lib/halal-fetch.test.ts`

**Interfaces:**

- Consumes: `HalalInfo`, `UNKNOWN_INFO`, `musaffaKey` (Task 1); `fetchMusaffa`, `MusaffaOutage` (Task 2); `isSafeAssetKey` (`src/lib/api-serve.ts`).
- Produces:
  - `assembleHalal(symbols: string[], byKey: Record<string, HalalInfo>): Record<string, HalalInfo>` — maps each symbol via `musaffaKey` to a record, unmatched → `UNKNOWN_INFO`.
  - `cacheGet(key: string, now: number): HalalInfo | null` / `cacheSet(key, info, now)` — best-effort ~5-min in-memory dedup (per warm instance).
  - `fetchHalal` — `createServerFn` taking `{ symbols: string[] }`, returns `Record<string, HalalInfo>` keyed by input symbol. Fail-open.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/halal-fetch.test.ts
import { describe, expect, it } from "bun:test";
import { assembleHalal, cacheGet, cacheSet } from "./halal-fetch.ts";
import { UNKNOWN_INFO, type HalalInfo } from "./halal/types.ts";

const AAPL: HalalInfo = {
  status: "halal",
  halalPct: 95,
  notHalalPct: 5,
  doubtfulPct: 0,
  exchange: "NASDAQ",
  ticker: "AAPL",
  musaffaUrl: "https://musaffa.com/stock/AAPL/NASDAQ",
};

describe("assembleHalal", () => {
  it("maps symbols to records by musaffaKey, unmatched -> unknown", () => {
    const out = assembleHalal(["AAPL", "BTC-USD"], { AAPL });
    expect(out.AAPL.status).toBe("halal");
    expect(out["BTC-USD"]).toEqual(UNKNOWN_INFO);
  });
  it("resolves class shares via the dot key", () => {
    const out = assembleHalal(["BRK-B"], { "BRK.B": { ...AAPL, ticker: "BRK.B" } });
    expect(out["BRK-B"].ticker).toBe("BRK.B");
  });
});

describe("cache", () => {
  it("returns null past TTL", () => {
    cacheSet("AAPL", AAPL, 0);
    expect(cacheGet("AAPL", 1000)).not.toBeNull();
    expect(cacheGet("AAPL", 6 * 60 * 1000 + 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/halal-fetch.test.ts`
Expected: FAIL — `Cannot find module './halal-fetch.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/halal-fetch.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve.ts";
import { type HalalInfo, UNKNOWN_INFO, musaffaKey } from "./halal/types.ts";
import { fetchMusaffa, MusaffaOutage } from "./halal/musaffa.ts";

// --- Best-effort in-memory dedup cache (per warm server instance) ----------
// Mirrors chart-fetch.ts: collapses repeated/concurrent hits within one warm
// instance. NOT durable on Vercel Fluid (evaporates on cold start) — real reuse
// is the client TanStack Query staleTime (halal-query.ts).
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, { at: number; info: HalalInfo }>();

export function cacheGet(key: string, now: number): HalalInfo | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.info;
}

export function cacheSet(key: string, info: HalalInfo, now: number): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, info });
}

export function assembleHalal(
  symbols: string[],
  byKey: Record<string, HalalInfo>,
): Record<string, HalalInfo> {
  const out: Record<string, HalalInfo> = {};
  for (const sym of symbols) {
    out[sym] = byKey[musaffaKey(sym)] ?? UNKNOWN_INFO;
  }
  return out;
}

const InputSchema = z.object({
  symbols: z.array(z.string().min(1).max(40)).max(300),
});

export const fetchHalal = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<Record<string, HalalInfo>> => {
    const { symbols } = data;
    const apiKey = process.env.MUSAFFA_API_KEY;
    if (!apiKey) {
      console.warn("[halal] MUSAFFA_API_KEY unset — returning unknown for all symbols");
      return Object.fromEntries(symbols.map((s) => [s, UNKNOWN_INFO]));
    }

    // Dedupe keys, drop anything that isn't a safe token before it reaches the
    // backtick-quoted filter_by (injection guard, same allowlist as the chart path).
    const keys = [...new Set(symbols.map(musaffaKey))].filter(isSafeAssetKey);

    const now = Date.now();
    const byKey: Record<string, HalalInfo> = {};
    const misses: string[] = [];
    for (const k of keys) {
      const hit = cacheGet(k, now);
      if (hit) byKey[k] = hit;
      else misses.push(k);
    }

    try {
      if (misses.length) {
        const fetched = await fetchMusaffa(misses, apiKey);
        for (const k of misses) {
          // Cache a found record; cache misses as UNKNOWN so we don't re-hit
          // Musaffa for an unlisted ticker every render within the TTL.
          const info = fetched[k] ?? UNKNOWN_INFO;
          cacheSet(k, info, now);
          byKey[k] = info;
        }
      }
    } catch (err) {
      const why = err instanceof MusaffaOutage ? "outage" : "error";
      console.warn(`[halal] Musaffa ${why}, failing open:`, (err as Error)?.message ?? err);
      return Object.fromEntries(symbols.map((s) => [s, UNKNOWN_INFO]));
    }

    return assembleHalal(symbols, byKey);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/halal-fetch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
bunx tsc --noEmit
git add src/lib/halal-fetch.ts src/lib/halal-fetch.test.ts
git commit -m "feat(halal): fetchHalal server fn with fail-open cache"
```

Expected typecheck: no new errors in `halal-fetch.ts` (pre-existing route-typegen errors elsewhere are unrelated).

---

## Task 4: `halalQuery` + `useHalalStatus`

**Files:**

- Create: `src/lib/halal-query.ts`
- Test: extend `src/lib/halal-fetch.test.ts` (queryKey shape only — the hook needs React context and is covered by visual verification).

**Interfaces:**

- Consumes: `fetchHalal` (Task 3); `HalalInfo` (Task 1); `usePreferences` (`src/lib/preferences.tsx`, after Task 5 adds `showHalalStatus`).
- Produces:
  - `halalQuery(symbols: string[])` → `queryOptions`.
  - `useHalalStatus(symbols: string[]): (symbol: string) => HalalInfo | undefined`.

> Note: this task references `showHalalStatus` from Task 5. If executing strictly in order, do Task 5 first, or accept a transient typecheck error on `usePreferences().showHalalStatus` until Task 5 lands. They may be committed together.

- [ ] **Step 1: Write the failing test (queryKey is stable + sorted)**

Append to `src/lib/halal-fetch.test.ts`:

```ts
import { halalQuery } from "./halal-query.ts";

describe("halalQuery", () => {
  it("keys by sorted symbols so order doesn't fragment the cache", () => {
    expect(halalQuery(["NVDA", "AAPL"]).queryKey).toEqual(["halal", ["AAPL", "NVDA"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/halal-fetch.test.ts`
Expected: FAIL — `Cannot find module './halal-query.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/halal-query.ts
import * as React from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchHalal } from "./halal-fetch.ts";
import { type HalalInfo } from "./halal/types.ts";
import { usePreferences } from "./preferences.tsx";

const STALE_MS = 12 * 60 * 60 * 1000; // 12h — real client-side reuse lives here
const GC_MS = 24 * 60 * 60 * 1000;

export function halalQuery(symbols: string[]) {
  const sorted = [...new Set(symbols)].sort();
  return queryOptions<Record<string, HalalInfo>>({
    queryKey: ["halal", sorted],
    queryFn: () => fetchHalal({ data: { symbols: sorted } }),
    staleTime: STALE_MS,
    gcTime: GC_MS,
  });
}

// Returns a lookup fn. Disabled (no network) unless the opt-in toggle is on.
export function useHalalStatus(symbols: string[]): (symbol: string) => HalalInfo | undefined {
  const { showHalalStatus } = usePreferences();
  const key = symbols.join(",");
  const sorted = React.useMemo(() => [...new Set(symbols)].sort(), [key]);
  const q = useQuery({
    ...halalQuery(sorted),
    enabled: showHalalStatus && sorted.length > 0,
  });
  return React.useCallback((symbol: string) => q.data?.[symbol], [q.data]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/halal-fetch.test.ts`
Expected: PASS (including the new `halalQuery` test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/halal-query.ts src/lib/halal-fetch.test.ts
git commit -m "feat(halal): halalQuery + useHalalStatus hook"
```

---

## Task 5: Preference toggle `showHalalStatus`

**Files:**

- Modify: `src/lib/preferences.tsx`
- Modify: `src/lib/preferences.test.ts`
- Modify: `src/components/Preferences.tsx`

**Interfaces:**

- Produces: `Preferences.showHalalStatus: boolean` (default `false`); `setShowHalalStatus(v: boolean)` on the context.

- [ ] **Step 1: Write the failing test**

In `src/lib/preferences.test.ts`, update the two existing `readStoredPrefs` assertions to include the new field, and add a round-trip:

```ts
// in "defaults when nothing stored"
expect(readStoredPrefs()).toEqual({
  theme: "auto",
  reduceMotion: false,
  reduceHaptics: false,
  showHalalStatus: false,
});

// in "reads persisted values" — add before the assertion:
localStorage.setItem("show-halal", "true");
// ...and extend the expected object:
expect(readStoredPrefs()).toEqual({
  theme: "dark",
  reduceMotion: true,
  reduceHaptics: true,
  showHalalStatus: true,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/preferences.test.ts`
Expected: FAIL — `readStoredPrefs()` result is missing `showHalalStatus`.

- [ ] **Step 3: Implement in `src/lib/preferences.tsx`**

Add to the `Preferences` interface (after `reduceHaptics`):

```ts
showHalalStatus: boolean;
```

Add to `DEFAULTS`:

```ts
  showHalalStatus: false,
```

Add to the `readStoredPrefs` return object:

```ts
    showHalalStatus: window.localStorage.getItem("show-halal") === "true",
```

Add to `PreferencesContextValue`:

```ts
  setShowHalalStatus: (v: boolean) => void;
```

Add the setter (after `setReduceHaptics`):

```ts
const setShowHalalStatus = React.useCallback((showHalalStatus: boolean) => {
  setPrefs((p) => ({ ...p, showHalalStatus }));
  window.localStorage.setItem("show-halal", String(showHalalStatus));
}, []);
```

Add it to the `useMemo` value object and its dependency array:

```ts
const value = React.useMemo<PreferencesContextValue>(
  () => ({ ...prefs, setTheme, setReduceMotion, setReduceHaptics, setShowHalalStatus }),
  [prefs, setTheme, setReduceMotion, setReduceHaptics, setShowHalalStatus],
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the toggle row in `src/components/Preferences.tsx`**

In `Body()`, destructure the new pieces:

```ts
const {
  reduceMotion,
  reduceHaptics,
  showHalalStatus,
  setReduceMotion,
  setReduceHaptics,
  setShowHalalStatus,
} = usePreferences();
```

Add a third `SwitchRow` after the "Reduce haptics" row, inside the same `space-y-4` div:

```tsx
<SwitchRow
  label="Show halal status"
  description="Badge stocks with their Musaffa Shariah-compliance rating."
  checked={showHalalStatus}
  onChange={setShowHalalStatus}
/>
```

- [ ] **Step 6: Typecheck + commit**

```bash
bunx tsc --noEmit
git add src/lib/preferences.tsx src/lib/preferences.test.ts src/components/Preferences.tsx
git commit -m "feat(halal): showHalalStatus preference + toggle"
```

---

## Task 6: Badge + preview-card components

**Files:**

- Create: `src/components/ui/preview-card.tsx` (via shadcn add)
- Create: `src/components/halal/halal-card-content.tsx`
- Create: `src/components/halal/halal-badge.tsx`

**Interfaces:**

- Consumes: `HalalInfo`, `badgeKindFor`, `purityFraction` (Task 1); `Gauge` (`src/components/charts/gauge.tsx`); `ChartBoundary` (`src/components/ChartBoundary`); the generated `preview-card`.
- Produces:
  - `HalalCardContent({ info }: { info: HalalInfo })` — presentational body.
  - `HalalBadge({ info }: { info: HalalInfo })` — icon, returns `null` when `badgeKindFor` is null.
  - `HalalIndicator({ info }: { info: HalalInfo })` — badge wrapped in a preview card; returns `null` when no badge kind.

- [ ] **Step 1: Add the coss preview-card primitive**

Run: `bunx --bun shadcn@latest add @coss/preview-card`
Expected: creates `src/components/ui/preview-card.tsx`. Then open it and note the exported names (Base UI PreviewCard parts — typically `PreviewCard`, `PreviewCardTrigger`, `PreviewCardContent` / `...Positioner`/`...Popup`). Use the exact exports it generated in Step 3.

- [ ] **Step 2: Build `HalalCardContent`**

```tsx
// src/components/halal/halal-card-content.tsx
import { Gauge } from "#/components/charts/gauge.tsx";
import { ChartBoundary } from "#/components/ChartBoundary";
import { purityFraction, type HalalInfo } from "#/lib/halal/types.ts";

const LABEL: Record<HalalInfo["status"], string> = {
  halal: "Shariah-compliant",
  doubtful: "Compliance questionable",
  not_halal: "Not compliant",
  unknown: "Compliance unknown",
};

export function HalalCardContent({ info }: { info: HalalInfo }) {
  return (
    <div className="w-64 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{LABEL[info.status]}</span>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          Musaffa
        </span>
      </div>
      <div className="mx-auto h-24 w-24">
        <ChartBoundary>
          <Gauge
            value={info.halalPct}
            centerValue={purityFraction(info.halalPct)}
            formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
            useGradient
            activeGradient={["#a855f7", "#06b6d4"]}
            inactiveGradient={["#334155", "#38bdf8"]}
            inactiveFillOpacity={0.4}
            startAngle={140}
            endAngle={400}
            notchCornerRadius={7}
            spacing={0}
          />
        </ChartBoundary>
      </div>
      <p className="text-xs text-muted-foreground">
        Halal {info.halalPct.toFixed(0)}% · doubtful {info.doubtfulPct.toFixed(0)}% · non-halal{" "}
        {info.notHalalPct.toFixed(0)}%
      </p>
      {info.musaffaUrl ? (
        <a
          href={info.musaffaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          View on Musaffa ↗
        </a>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Build `HalalBadge` + `HalalIndicator`**

Adjust the `preview-card` import names to match what Step 1 generated.

```tsx
// src/components/halal/halal-badge.tsx
import { CircleQuestionMark } from "lucide-react";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardContent,
} from "#/components/ui/preview-card.tsx";
import { badgeKindFor, type HalalInfo } from "#/lib/halal/types.ts";
import { HalalCardContent } from "./halal-card-content.tsx";

export function HalalBadge({ info }: { info: HalalInfo }) {
  const kind = badgeKindFor(info.status);
  if (kind === "halal") {
    return (
      <span
        role="img"
        aria-label="Shariah-compliant (Musaffa)"
        className="icon-[hugeicons--halal] size-[1.1em] text-emerald-500 align-[-0.15em]"
      />
    );
  }
  if (kind === "doubtful") {
    return (
      <CircleQuestionMark
        aria-label="Shariah compliance questionable (Musaffa)"
        className="size-[1.1em] text-amber-500 align-[-0.15em]"
      />
    );
  }
  return null;
}

export function HalalIndicator({ info }: { info: HalalInfo }) {
  if (badgeKindFor(info.status) === null) return null;
  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={
          <button
            type="button"
            className="inline-flex cursor-default items-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Halal compliance details"
          />
        }
      >
        <HalalBadge info={info} />
      </PreviewCardTrigger>
      <PreviewCardContent className="rounded-xl border border-border/60 bg-background p-3 shadow-lg">
        <HalalCardContent info={info} />
      </PreviewCardContent>
    </PreviewCard>
  );
}
```

> If the generated `PreviewCardTrigger` doesn't accept a `render` prop (Base UI vs shadcn wrapper differences), wrap the badge in the trigger as a child instead and make the trigger element a `button`. The contract: trigger is keyboard-focusable and tap-operable.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors in the three new files. Fix import-name mismatches against the generated preview-card.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/preview-card.tsx src/components/halal/
git commit -m "feat(halal): badge, preview card, and Musaffa gauge content"
```

---

## Task 7: Wire badges into the surfaces

**Files:**

- Modify: `src/routes/t.$symbol.tsx`
- Modify: `src/routes/explore.tsx`
- Modify: `src/routes/c.$handle.index.tsx`
- Modify: `src/routes/c.$handle.ticker.$symbol.tsx`

**Interfaces:**

- Consumes: `useHalalStatus` (Task 4), `HalalIndicator`, `HalalCardContent` (Task 6), `UNKNOWN_INFO` (Task 1).

Pattern for every route: collect the displayed symbols, call `useHalalStatus(symbols)` once at the top of the component, then render `<HalalIndicator info={getInfo(sym) ?? UNKNOWN_INFO} />` next to each symbol. `HalalIndicator` returns `null` for unknown, so off-toggle and unlisted symbols render nothing.

- [ ] **Step 1: `t.$symbol.tsx` — header badge + inline card**

In `TickerView`, after the `summary` is read from `Route.useLoaderData()`, add:

```tsx
const getHalal = useHalalStatus([summary.symbol]);
const halal = getHalal(summary.symbol) ?? UNKNOWN_INFO;
```

Imports at top:

```tsx
import { useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { HalalCardContent } from "#/components/halal/halal-card-content.tsx";
import { UNKNOWN_INFO } from "#/lib/halal/types.ts";
```

Change the `<h1>` to include the badge:

```tsx
<h1 className="mt-1 flex items-center gap-2 font-heading text-2xl">
  {summary.symbol}
  <HalalIndicator info={halal} />
</h1>
```

Add the inline card as a new section after the `<header>` (gated: only when not unknown):

```tsx
{
  halal.status !== "unknown" ? (
    <section className="rounded-2xl border border-border/60 bg-background p-4">
      <HalalCardContent info={halal} />
    </section>
  ) : null;
}
```

- [ ] **Step 2: `c.$handle.ticker.$symbol.tsx` — header badge**

Find the symbol header (the `<h1>`/title rendering `params.symbol`). Add at the top of the component body:

```tsx
const getHalal = useHalalStatus([params.symbol]);
```

Imports:

```tsx
import { useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { UNKNOWN_INFO } from "#/lib/halal/types.ts";
```

Render `<HalalIndicator info={getHalal(params.symbol) ?? UNKNOWN_INFO} />` adjacent to the symbol in the header (match the existing flex/gap layout).

- [ ] **Step 3: `explore.tsx` — row badges**

The component maps `rows.slice(0, 500).map((r) => ...)`; the symbol is `r.ticker`,
rendered as a `<Link to="/t/$symbol" params={{ symbol: r.ticker }}>{r.ticker}</Link>`
(~line 117). Imports as in Step 2 (`useHalalStatus`, `HalalIndicator`, `UNKNOWN_INFO`).
At the top of the component body add:

```tsx
const getHalal = useHalalStatus(rows.map((r) => r.ticker));
```

Wrap the ticker `Link` so the badge sits next to it:

```tsx
<span className="inline-flex items-center gap-1.5">
  <Link
    to="/t/$symbol"
    params={{ symbol: r.ticker }}
    className="font-medium text-sm text-foreground no-underline hover:underline"
  >
    {r.ticker}
  </Link>
  <HalalIndicator info={getHalal(r.ticker) ?? UNKNOWN_INFO} />
</span>
```

- [ ] **Step 4: `c.$handle.index.tsx` — call-list row badges**

The badge belongs in the call rows. In `CallsList` (it receives `calls: Call[]` and
maps `visible.map((c) => <CallRow ... />)`), compute the lookup once and pass the
per-row info into `CallRow`:

```tsx
const getHalal = useHalalStatus(calls.map((c) => c.ticker));
```

Add an `info` prop to `CallRow` (`info: HalalInfo`) and pass `info={getHalal(call.ticker) ?? UNKNOWN_INFO}` from the `visible.map` callback. In `CallRow`, beside the ticker label (`<span ...>{call.ticker}</span>`, ~line 437) render:

```tsx
<span className="inline-flex items-center gap-1.5">
  <span className="shrink-0 font-mono text-sm text-foreground">{call.ticker}</span>
  <HalalIndicator info={info} />
</span>
```

Imports for this file: `useHalalStatus`, `HalalIndicator`, and `HalalInfo` + `UNKNOWN_INFO` from `#/lib/halal/types.ts`.

- [ ] **Step 5: Typecheck + build**

Run: `bunx tsc --noEmit && bun run build`
Expected: typecheck has no new errors in the four routes; build completes (Vercel Build Output emitted). Pre-existing route-typegen warnings unrelated to halal are fine.

- [ ] **Step 6: Commit**

```bash
git add src/routes/t.\$symbol.tsx src/routes/explore.tsx src/routes/c.\$handle.index.tsx src/routes/c.\$handle.ticker.\$symbol.tsx
git commit -m "feat(halal): wire badge + inline card into ticker, explore, creator surfaces"
```

---

## Task 8: Local key, env example, and docs

**Files:**

- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Local only (not committed): `.env`

**Interfaces:** none (config + docs).

- [ ] **Step 1: Provision the key locally (operator step)**

Fetch the value from the VM and append to the worktree's gitignored `.env`:

```bash
KEY=$(ssh ubuntu@imos-vm 'grep -E "^MUSAFFA_API_KEY=" ~/stock-pipeline-v2/.env | cut -d= -f2-')
printf '\nMUSAFFA_API_KEY=%s\n' "$KEY" >> .env
```

Verify: `grep -c MUSAFFA_API_KEY .env` → `1`. (`.env` is gitignored — never commit it.)

- [ ] **Step 2: Document the key in `.env.example`**

Append:

```
# Musaffa Shariah-compliance (halal badge). Typesense search-only key (read-only),
# from stock-pipeline-v2/.env. Server-side only. Unset => badges show nothing (fail-open).
MUSAFFA_API_KEY=
```

- [ ] **Step 3: Add a CLAUDE.md section**

Add after the "Profile pics" section (before "Component provenance"):

```markdown
## Halal compliance badge

Opt-in (`showHalalStatus` preference, off by default) Shariah-compliance badge on
tracked tickers: `hugeicons:halal` for compliant, lucide circle-question-mark for
doubtful; not-halal/unknown render nothing. Hover/tap opens a coss `preview-card`
with a revenue-purity bklit `Gauge` + a link to the stock's Musaffa page; the same
`HalalCardContent` renders as an inline section on `/t/$symbol`.

**Live, not baked.** Halal status is dynamic (flips on earnings), so it follows the
"live for display" path, not the frozen-scoring path. `fetchHalal` (`src/lib/halal-fetch.ts`,
a `createServerFn`) queries Musaffa's Typesense `stocks_data` collection
(`src/lib/halal/musaffa.ts`, port of the VM's `musaffa_client.py`) with the
server-side `MUSAFFA_API_KEY`; `useHalalStatus` (`src/lib/halal-query.ts`) caches it
client-side (12h staleTime) and is disabled unless the toggle is on. Fail-open: any
error / missing key / unmatched symbol → `unknown` → nothing renders.

**Symbol keying gotcha.** Do NOT run `resolveSymbol` before a Musaffa lookup — it
canonicalizes toward Yahoo (`BRK-B`, `BTC-USD`, `HEIA.AS`). Musaffa keys by US ticker
with a dot for class shares (`BRK.B`). Use `musaffaKey` (`src/lib/halal/types.ts`):
uppercase, strip `$`, class-share dash→dot. Crypto/foreign listings won't match →
`unknown` (correct — Musaffa has no rating for them).

`MUSAFFA_API_KEY` (Typesense search-only key) must be set in local `.env` and Vercel
prod env. It's read-only and already ships in Musaffa's own web client; kept
server-side to keep it out of our client bundle.
```

- [ ] **Step 4: Commit**

```bash
bun test
git add .env.example CLAUDE.md
git commit -m "docs(halal): env example + CLAUDE.md section"
```

Expected: `bun test` green (all halal tests + the existing suite, 0 fail).

---

## Post-implementation (after all tasks)

1. **Worktree gate:** `bunx tsc --noEmit && bun test && bun run build` all clean in the worktree.
2. **Merge to `main`** (per project workflow) and set `MUSAFFA_API_KEY` in the local `main` `.env`.
3. **Visual verification on `main`** (single dev server): toggle "Show halal status" on; confirm the `hugeicons:halal` badge on a compliant ticker (e.g. AAPL), the question-mark on a doubtful one, the preview card gauge reads a sane percent (not "9500%"), the Musaffa link opens the right page, and the inline card shows on `/t/$symbol`. Confirm badges are absent with the toggle off. (Use a real browser — `IntersectionObserver`/reveal gating misbehaves under automation.)
4. **Vercel:** add `MUSAFFA_API_KEY` to the production environment before the deploy that ships this.
