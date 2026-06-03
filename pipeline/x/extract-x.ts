import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, creatorDir } from "../config";
import { fireworks, FIREWORKS_MODEL, FIREWORKS_VISION_MODEL } from "../fireworks";
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

export async function tweetToReelCall(t: TweetRecord, handle: string, deps: ExtractDeps): Promise<ReelCall | null> {
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
  // Whole X path runs on Fireworks (no Groq throttling at this scale): text via
  // gpt-oss-120b, image hints via the cheapest serverless VLM (qwen3p6-plus).
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
  const out: ReelCall[] = existsSync(join(creatorDir(handle), "reel-calls.json"))
    ? JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"))
    : [];
  const pending = tweets.filter((t) => !done.has(t.id));
  if (done.size) console.log(`resuming: ${done.size} done, ${pending.length} pending, ${out.length} calls so far`);

  // Vision is ~15s/image, so run tweets concurrently; Fireworks isn't rate-capped.
  const LIMIT = 10;
  for (let i = 0; i < pending.length; i += LIMIT) {
    const batch = pending.slice(i, i + LIMIT);
    const results = await Promise.all(batch.map(async (t) => {
      try { return await tweetToReelCall(t, handle, deps); }
      catch (e) { console.warn(`skip ${t.id}: ${(e as Error).message}`); return null; }
    }));
    results.forEach((rc) => { if (rc) out.push(rc); });
    batch.forEach((t) => done.add(t.id));
    await writeCalls(handle, out);                                  // durable results
    await writeFile(donePath, JSON.stringify([...done]));           // durable progress
    console.log(`extracted ${done.size}/${tweets.length} tweets -> ${out.length} calls`);
  }
  return out;
}
