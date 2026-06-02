import { existsSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { creatorDir, transcriptsDir, framesDir, rawDir } from "./config";
import { groq, discoverModels } from "./groq";
import type { ReelCall } from "../src/lib/types";

const SYS =
  "You analyze a stock-influencer reel. Decide if it makes an EXPLICIT BULLISH call " +
  "(names a ticker AND tells viewers to buy/hold it). Use the transcript, caption, and " +
  "on-screen hints (the hints are authoritative for the exact ticker symbol). " +
  'Reply ONLY JSON: {"ticker":string|null,"company":string|null,"direction":"bullish"|"bearish"|"neutral",' +
  '"isExplicitBuy":boolean,"conviction":number,"quote":string,"onScreenPrice":number|null}. ' +
  "ticker null if no specific stock. conviction 0..1.";

async function postDateOf(handle: string, code: string): Promise<string> {
  // yt-dlp info json: upload_date YYYYMMDD
  const dir = join(rawDir(handle), code);
  const info = (await readdir(dir)).find(f => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    if (j.upload_date) return `${j.upload_date.slice(0,4)}-${j.upload_date.slice(4,6)}-${j.upload_date.slice(6,8)}`;
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
    const user = `TRANSCRIPT:\n${tr.text}\n\nON-SCREEN HINTS:\n${JSON.stringify(hints)}`;
    const r = await (await groq("/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: text, temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYS }, { role: "user", content: user }] }),
    })).json();
    let parsed: any;
    try { parsed = JSON.parse(r.choices[0].message.content); }
    catch { console.warn(`skip ${code}: malformed extract response`); continue; }
    if (!parsed.ticker) continue;
    out.push({ shortcode: code, postDate: await postDateOf(handle, code),
      ticker: String(parsed.ticker).toUpperCase(), company: parsed.company ?? "",
      direction: parsed.direction ?? "neutral", isExplicitBuy: !!parsed.isExplicitBuy,
      conviction: Number(parsed.conviction ?? 0), quote: parsed.quote ?? "",
      onScreenPrice: parsed.onScreenPrice ?? null });
  }
  await writeFile(join(creatorDir(handle), "reel-calls.json"), JSON.stringify(out, null, 2));
  await writeReview(handle, out);
  return out;
}

async function writeReview(handle: string, calls: ReelCall[]) {
  const bullish = calls.filter(c => c.isExplicitBuy && c.direction === "bullish");
  const lines = ["# Calls review — verify before scoring", "",
    `Total reels with a ticker: ${calls.length}. Explicit bullish calls: ${bullish.length}.`, "",
    "| date | ticker | buy? | dir | conv | quote |", "|---|---|---|---|---|---|",
    ...calls.sort((a,b)=>a.postDate.localeCompare(b.postDate)).map(c =>
      `| ${c.postDate} | ${c.ticker} | ${c.isExplicitBuy?"✅":""} | ${c.direction} | ${c.conviction} | ${c.quote.replace(/\|/g," ").slice(0,60)} |`)];
  await writeFile(join(creatorDir(handle), "calls.review.md"), lines.join("\n"));
}
