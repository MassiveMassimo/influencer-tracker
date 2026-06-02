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
  const { text, vision } = await discoverModels();
  const deps: ExtractDeps = { text, vision, classifyFn: classify, readImageFn: readImage };
  const tweets: TweetRecord[] = JSON.parse(await readFile(join(rawDir(handle), "tweets.json"), "utf8"));
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
