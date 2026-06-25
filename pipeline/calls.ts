import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { creatorDir } from "./config";
import type { Direction, ReelCall } from "../src/lib/types";

// A single post can name MULTIPLE stocks (e.g. "loading up on NVDA and AMD,
// holding TSLA, avoid INTC"). The model emits one entry per ticker the creator
// takes a view on, so a multi-stock post is no longer collapsed to a single call.
// `isExplicitBuy` covers the call formats finfluencers actually use — not just a
// literal "buy" instruction but also a stated long position and bullish price
// targets ("$AMD to 750") — so the scored set isn't gutted (an earlier draft that
// said only "tells viewers to buy/hold" dropped ~49% of real buys: price targets).
// The context/index/competitor exclusion keeps the stored set clean (those would
// never be scored anyway — only isExplicitBuy && bullish is).
// Bake-off 2026-06-24 (thelonginvest, deepseek-v4-flash): added the retrospective
// track-record rule below. The recurring failure was a "first to call X at $Y" / "my
// best buy was X at $Y" recap read as live calls — it flooded the scored set with false
// buys at historical entry prices while the actual forward picks were dropped. The rule
// also encodes three discriminators surfaced in review: (1) PRECEDENCE — a current
// position/add/hold wins over a historical-entry brag in the same line; (2) attributed
// third-party ratings (analyst PTs) are not the creator's call unless endorsed; (3) the
// forward-pick rule never overrides the watchlist/index exclusions. Regression-pinned by
// the labeled eval in calls.eval.test.ts (gated on FIREWORKS_API_KEY && RUN_LLM_EVAL).
// v2 2026-06-25: a trial re-extract of thelonginvest's history surfaced the mirror failure
// — the forward-pick rule OVER-emitted on retrospective/ambiguous lists (counterfactual
// hindsight "you didn't buy $X at $low", past-performance recaps "gains of the year $X",
// gloats "$X running this week / always winning"). Added the past-performance/hindsight
// clause below: a multi-ticker list scores only when framed as a PRESENT recommendation,
// not by past results or audience hindsight. Eval extended with these cases (15/15).
export const CLASSIFY_SYS =
  "You analyze a stock influencer's post (a video transcript or a tweet). A single post may " +
  "discuss MULTIPLE stocks. Emit ONE entry per distinct ticker the creator expresses a view on or " +
  "position in. For each, set its `direction` (bullish/bearish/neutral) and `isExplicitBuy`: true " +
  "when the creator makes a bullish call to OWN the stock — an explicit buy/hold instruction, a stated " +
  "long position, OR a bullish price target or 'going higher' conviction call (e.g. '$AMD to 750', " +
  "'NVDA to $200', 'next stop $400'); false for bearish/short calls and for neutral or " +
  "watchlist/no-position mentions. Do NOT emit tickers named only as market context, an index/benchmark, " +
  "or a competitor the creator is not recommending. Use the provided text and on-screen/image hints " +
  "(the hints are authoritative for the exact ticker symbol). " +
  // Retrospective track-record brags are NOT current calls. Without this, a recap
  // tweet ("first to share $PLTR at $7", "my safest buy was $UNH at $241") flooded
  // the scored set with false buys at historical entry prices while the actual
  // forward picks ("my next buy is $X/$Y") were dropped. See the bake-off note above.
  "CRITICAL — distinguish the creator's CURRENT view from a RETROSPECTIVE TRACK-RECORD claim. " +
  "A line bragging about a PAST entry or a past correct call is NOT a current call and its price is a " +
  "historical entry, not a recommendation: e.g. 'first to share/call/be bullish on $X at $Y', " +
  "'I told you to buy $X at $Y', 'my safest/smartest/best buy was $X at $Y', 'called $X at $Y', " +
  "'nailed $X'. For such tickers set isExplicitBuy=false (emit as a neutral mention, or omit). " +
  "This ALSO covers PAST-PERFORMANCE recaps and AUDIENCE-HINDSIGHT framing — NOT calls no matter how " +
  "many tickers they list: superlative-performance lists ('easiest/safest/smartest/most rewarding gains " +
  "of the year $X', 'most satisfying/relief $X', '$X running this week', 'always winning', '$X now +N%', " +
  "'best month ever'), and counterfactual hindsight ('you didn't buy $X at $low but like it at $high', " +
  "'if you had bought $X at $low'). The historical or performance prices in these are not recommendations. " +
  "A multi-ticker list is a CURRENT call only when framed as a present recommendation or live thesis — " +
  "'bullish setups right now', 'what we like now', '$X is undervalued / will 2-3X', 'buying $X here / under " +
  "its 200 WMA', 'accumulate $X'; a list framed by past results or audience hindsight is NOT. " +
  "PRECEDENCE: a CURRENT position, add, or hold statement makes the ticker a current bullish call even " +
  "when the SAME line also cites a historical entry price — e.g. 'held $NVDA since $90 and still adding', " +
  "'I want $X to hit $92 next', '$X is going to $22' → isExplicitBuy=true (the current action wins over " +
  "the historical-price brag). " +
  "A forward-looking pick list the creator presents as their CURRENT picks is also a current call " +
  "(isExplicitBuy=true) even without a per-ticker thesis — e.g. after 'so what's next?' a list '$A $B $C', " +
  "'these are my buys here', or 'my next buy is $X/$Y'. " +
  "A rating or price target the creator ATTRIBUTES to a third party (e.g. 'JPM raises $UNH PT to $466') is " +
  "NOT the creator's call unless the creator endorses or acts on it ('…and I agree, buying here') — " +
  "attribution-only → isExplicitBuy=false, endorsed/acted-on → true. " +
  "None of these override the watchlist/no-position or index/benchmark/market-context exclusions: " +
  "'on my radar'/'watching, no position yet' stay isExplicitBuy=false, and $SPY/$QQQ etc. stay excluded. " +
  'Reply ONLY JSON: {"calls":[{"ticker":string,"company":string|null,"direction":"bullish"|"bearish"|"neutral",' +
  '"isExplicitBuy":boolean,"conviction":number,"quote":string,"onScreenPrice":number|null,"summary":string}]}. ' +
  "Use an empty array [] if the post names no specific stock the creator has a view on. One entry per ticker; " +
  "conviction 0..1; quote is the verbatim phrase for THAT ticker; summary is one neutral sentence (<160 chars) " +
  "on what the post says about that stock and the thesis for it.";

export interface Classification {
  ticker: string | null;
  company: string | null;
  direction: Direction;
  isExplicitBuy: boolean;
  conviction: number;
  quote: string;
  onScreenPrice: number | null;
  summary: string;
}

// Runtime validation of one entry in the LLM reply array. The model is instructed to emit
// exactly this shape (see CLASSIFY_SYS); coerce/clamp the few fields a model realistically
// gets slightly wrong rather than rejecting the whole call.
const ClassificationSchema = z.object({
  ticker: z.string().nullable().catch(null),
  company: z.string().nullable().catch(null),
  direction: z.enum(["bullish", "bearish", "neutral"]).catch("neutral"),
  isExplicitBuy: z.boolean().catch(false),
  conviction: z.number().catch(0).transform((v) => Math.min(1, Math.max(0, v))),
  quote: z.string().catch(""),
  onScreenPrice: z.number().nullable().catch(null),
  summary: z.string().catch(""),
});

// The envelope: a `calls` array. Be lenient about the few shapes a model lands on under
// json_object — accept the canonical {calls:[…]}, an empty/absent array, or (defensively)
// a bare single object emitted at the top level, normalizing all to Classification[].
const ReplySchema = z.object({ calls: z.array(ClassificationSchema).catch([]) });

// One LLM classification call. Throws on an unreadable reply (missing envelope or
// non-JSON content) so the caller's retry loop re-runs the post; returns the
// validated per-ticker Classifications otherwise (an empty array is a genuine
// no-stock reply, handled downstream by toReelCalls). `client` is the OpenAI-compatible
// POST fn (fireworks). Both platforms share this prompt/parse so they never diverge.
type ChatClient = (path: string, init?: RequestInit) => Promise<Response>;

export async function classify(
  textModel: string,
  body: string,
  client: ChatClient,
): Promise<Classification[]> {
  const r = await (await client("/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: textModel, temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: CLASSIFY_SYS }, { role: "user", content: body }],
    }),
  })).json() as { choices?: { message?: { content?: string } }[] };
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
  // Canonical shape is {calls:[…]}. Defensively accept a bare single object (a model
  // occasionally drops the envelope) by wrapping it before validation.
  const enveloped =
    raw && typeof raw === "object" && !Array.isArray(raw) && !("calls" in raw)
      ? { calls: [raw] }
      : raw;
  return ReplySchema.parse(enveloped).calls;
}

// Normalize a post's classifications into ReelCalls — one per named ticker. Entries
// with no ticker are dropped (not a stock call). Duplicate tickers within the same
// post (same uppercased symbol) are collapsed to the first occurrence so a post never
// emits two calls for the same stock (the (handle, shortcode, ticker) identity must be
// unique); a later same-stock entry from a sloppy reply is redundant, not a new call.
export function toReelCalls(cs: Classification[], shortcode: string, postDate: string): ReelCall[] {
  const seen = new Set<string>();
  const out: ReelCall[] = [];
  for (const c of cs) {
    if (!c.ticker) continue;
    // Strip a leading "$" some models keep ($TSLA): the symbol must be the bare
    // ticker or it never resolves on Yahoo. Skip if nothing's left.
    const ticker = String(c.ticker).toUpperCase().replace(/^\$+/, "");
    if (!ticker) continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({
      shortcode, postDate, ticker,
      company: c.company ?? "",
      direction: c.direction ?? "neutral",
      isExplicitBuy: !!c.isExplicitBuy,
      conviction: Number(c.conviction ?? 0),
      quote: c.quote ?? "",
      onScreenPrice: c.onScreenPrice ?? null,
      summary: c.summary ?? "",
    });
  }
  return out;
}

// Markdown review table the human checks before pricing/scoring.
export function buildReview(calls: ReelCall[]): string {
  const bullish = calls.filter((c) => c.isExplicitBuy && c.direction === "bullish");
  return [
    "# Calls review — verify before scoring", "",
    // One row per (post, ticker): a post naming multiple stocks contributes several rows.
    `Total ticker calls: ${calls.length} across ${new Set(calls.map((c) => c.shortcode)).size} posts. ` +
      `Explicit bullish calls: ${bullish.length}.`, "",
    "| date | ticker | buy? | dir | conv | quote |", "|---|---|---|---|---|---|",
    ...[...calls].sort((a, b) => a.postDate.localeCompare(b.postDate)).map((c) =>
      `| ${c.postDate} | ${c.ticker} | ${c.isExplicitBuy ? "✅" : ""} | ${c.direction} | ${c.conviction} | ${c.quote.replace(/\|/g, " ").slice(0, 60)} |`),
  ].join("\n");
}

// Write the intermediate dataset both scoring and the human review consume.
export async function writeCalls(handle: string, calls: ReelCall[]): Promise<void> {
  await writeFile(join(creatorDir(handle), "reel-calls.json"), JSON.stringify(calls, null, 2));
  await writeFile(join(creatorDir(handle), "calls.review.md"), buildReview(calls));
}
