import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, creatorDir } from "../config";
import { fireworks, FIREWORKS_MODEL, FIREWORKS_VISION_MODEL } from "../fireworks";
import { classify, toReelCalls, writeCalls, type Classification } from "../calls";
import { readImage, type FrameHint } from "../vision";
import type { TweetRecord } from "./scrape-x";
import type { ReelCall } from "../../src/lib/types";

// Identity of a single call within the corpus: a post (tweet id) plus its ticker,
// since one post can name multiple stocks. Mirrors the (handle, shortcode, ticker) key.
const callKey = (c: ReelCall): string => `${c.shortcode}:${c.ticker}`;

// Collapse duplicate calls by (shortcode, ticker), keeping the first occurrence.
// Guards against a crash between the two checkpoint writes re-appending a call.
export function dedupeCalls(calls: ReelCall[]): ReelCall[] {
  const seen = new Set<string>();
  const result: ReelCall[] = [];
  for (const c of calls) {
    if (seen.has(callKey(c))) continue;
    seen.add(callKey(c));
    result.push(c);
  }
  return result;
}

// Injected so the assembly can be unit-tested without hitting the network.
export interface ExtractDeps {
  text: string;
  vision: string;
  classifyFn: (textModel: string, body: string) => Promise<Classification[]>;
  readImageFn: (vision: string, imgPath: string) => Promise<FrameHint>;
}

export function tweetDate(createdAt: string): string {
  return new Date(createdAt).toISOString().slice(0, 10);
}

// A tweet can name multiple stocks → zero or more ReelCalls (one per ticker).
export async function tweetToReelCalls(t: TweetRecord, handle: string, deps: ExtractDeps): Promise<ReelCall[]> {
  const dir = join(rawDir(handle), t.id);
  let hints: FrameHint[] = [];
  if (existsSync(dir)) {
    const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
    hints = await Promise.all(files.map((f) => deps.readImageFn(deps.vision, join(dir, f))));
  }
  const body = `TWEET:\n${t.text}\n\nIMAGE HINTS:\n${JSON.stringify(hints)}`;
  const cs = await deps.classifyFn(deps.text, body);
  return toReelCalls(cs, t.id, tweetDate(t.createdAt));
}

export async function extractX(handle: string) {
  // Whole X path runs on Fireworks (no Groq throttling at this scale): text via
  // deepseek-v4-flash, image hints via kimi-k2p5.
  const deps: ExtractDeps = {
    text: FIREWORKS_MODEL,
    vision: FIREWORKS_VISION_MODEL,
    classifyFn: (m, b) => classify(m, b, fireworks),
    readImageFn: (m, p) => readImage(m, p, fireworks),
  };
  const tweets: TweetRecord[] = JSON.parse(await readFile(join(rawDir(handle), "tweets.json"), "utf8"));

  // Resume: skip tweets already processed (call or not), keep prior calls.
  const donePath = join(rawDir(handle), "extract-done.json");
  const done = new Set<string>(
    existsSync(donePath) ? JSON.parse(await readFile(donePath, "utf8")) : [],
  );
  const loaded: ReelCall[] = existsSync(join(creatorDir(handle), "reel-calls.json"))
    ? JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"))
    : [];
  const out: ReelCall[] = dedupeCalls(loaded);
  const seenCalls = new Set(out.map(callKey));
  if (done.size) console.log(`resuming: ${done.size} done, ${tweets.length - done.size} pending, ${out.length} calls so far`);

  // Continuous worker pool. Fireworks isn't request-capped (adaptive per-model TPM
  // limits, and fireworks() backs off on 429/503), so keep CONCURRENCY tweets in
  // flight rather than fixed batches that stall on their single slowest member.
  // Vision latency is ~9s, so saturating the per-model generated-TPM wall takes a
  // high worker count; backoff caps any overshoot. Tune via X_EXTRACT_CONCURRENCY.
  const CONCURRENCY = Number(process.env.X_EXTRACT_CONCURRENCY) || 96;
  let completed = 0;

  // Serialize checkpoint writes so overlapping workers never clobber the files.
  let writeChain: Promise<void> = Promise.resolve();
  const persist = () => {
    writeChain = writeChain.then(async () => {
      await writeCalls(handle, out);                                // durable results
      await writeFile(donePath, JSON.stringify([...done]));         // durable progress
    });
    return writeChain;
  };

  // Heal-loop: a tweet that throws (e.g. a 429 that outlives backoff) is NOT
  // marked done, so the next pass retries it. As the leftover set shrinks below
  // CONCURRENCY the effective parallelism drops, clearing the rate-limit wall.
  for (let pass = 1; ; pass++) {
    const pending = tweets.filter((t) => !done.has(t.id));
    if (!pending.length) break;
    const before = done.size;
    if (pass > 1) console.log(`heal pass ${pass}: ${pending.length} left`);
    let next = 0;

    const worker = async () => {
      while (next < pending.length) {
        const t = pending[next++];
        try {
          const rcs = await tweetToReelCalls(t, handle, deps);
          for (const rc of rcs) {                                   // one tweet → 0+ ticker calls
            if (seenCalls.has(callKey(rc))) continue;
            seenCalls.add(callKey(rc));
            out.push(rc);
          }
          done.add(t.id);                                           // mark done only on success
        } catch (e) {
          console.warn(`skip ${t.id}: ${(e as Error).message}`);   // left un-done; retried next pass
        }
        if (++completed % 20 === 0) {
          await persist();
          console.log(`extracted ${done.size}/${tweets.length} tweets -> ${out.length} calls`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
    await persist();
    if (done.size === before) {                                    // a pass that helped nobody
      console.warn(`no progress on ${pending.length} tweets; giving up`);
      break;
    }
  }
  console.log(`extracted ${done.size}/${tweets.length} tweets -> ${out.length} calls`);
  return out;
}
