import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { creatorDir } from "./config";
import { groq } from "./groq";
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
// POST fn (groq by default, fireworks for the high-volume X path). Both share this
// prompt/parse so platforms never diverge.
type ChatClient = (path: string, init?: RequestInit) => Promise<Response>;

export async function classify(
  textModel: string,
  body: string,
  client: ChatClient = groq,
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
