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
  '"isExplicitBuy":boolean,"conviction":number,"quote":string,"onScreenPrice":number|null,"summary":string}. ' +
  "ticker null if no specific stock. conviction 0..1. summary is one neutral sentence (<160 chars) on what " +
  "the post is about and the thesis for the stock.";

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

// One LLM classification call. Returns null on malformed JSON (caller skips).
export async function classify(textModel: string, body: string): Promise<Classification | null> {
  const r = await (await groq("/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: textModel, temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: CLASSIFY_SYS }, { role: "user", content: body }],
    }),
  })).json() as { choices: { message: { content: string } }[] };
  try {
    return JSON.parse(r.choices[0].message.content) as Classification;
  } catch {
    return null;
  }
}

// Normalize a classification into a ReelCall. Null if no ticker (not a stock call).
export function toReelCall(c: Classification, shortcode: string, postDate: string): ReelCall | null {
  if (!c.ticker) return null;
  return {
    shortcode, postDate,
    ticker: String(c.ticker).toUpperCase(),
    company: c.company ?? "",
    direction: c.direction ?? "neutral",
    isExplicitBuy: !!c.isExplicitBuy,
    conviction: Number(c.conviction ?? 0),
    quote: c.quote ?? "",
    onScreenPrice: c.onScreenPrice ?? null,
    summary: c.summary ?? "",
  };
}

// Markdown review table the human checks before pricing/scoring.
export function buildReview(calls: ReelCall[]): string {
  const bullish = calls.filter((c) => c.isExplicitBuy && c.direction === "bullish");
  return [
    "# Calls review — verify before scoring", "",
    `Total posts with a ticker: ${calls.length}. Explicit bullish calls: ${bullish.length}.`, "",
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
