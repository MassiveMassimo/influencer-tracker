import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { transcriptsDir, framesDir, rawDir } from "./config";
import { fireworks, FIREWORKS_MODEL } from "./fireworks";
import { classify, toReelCalls, writeCalls } from "./calls";
import { loadPostDates, savePostDates, mergePostDates } from "./post-dates";
import type { ReelCall } from "../src/lib/types";

// Pure: format a yt-dlp upload_date (YYYYMMDD) or return null. Exported for tests.
export function formatUploadDate(uploadDate: unknown): string | null {
  if (typeof uploadDate !== "string" || !/^\d{8}$/.test(uploadDate)) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

// Durable store WINS: the anchor must not flip based on whether raw/ is present this run
// (that would silently restate forward returns). info.json is only a gap-filler for a reel
// not yet in the store; the caller freezes that resolved date back into the store. Null when
// both miss — skip rather than fabricate (a wrong anchor silently corrupts every return).
export async function postDateOf(
  store: Record<string, string>,
  handle: string,
  code: string,
): Promise<string | null> {
  if (store[code]) return store[code];
  const dir = join(rawDir(handle), code);
  if (!existsSync(dir)) return null;
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    return formatUploadDate(j.upload_date);
  }
  return null;
}

export async function extract(handle: string) {
  // Classification on Fireworks (like the X path) — Groq's free tier throttled it.
  const text = FIREWORKS_MODEL;
  const files = (await readdir(transcriptsDir(handle))).filter((f) => f.endsWith(".json"));

  // Classify is the only network call here (vision hints are precomputed in the
  // frames stage), so run a worker pool instead of one reel at a time. Results
  // go into a per-index slot and are flattened in order, so reel-calls.json keeps
  // source-file order (the DB `ord` column) regardless of completion order.
  // Tune via EXTRACT_CONCURRENCY; fireworks() backs off on 429/503.
  const results: ReelCall[][] = Array.from({ length: files.length }, () => []);
  const CONCURRENCY = Number(process.env.EXTRACT_CONCURRENCY) || 24;
  let next = 0;

  // Durable post-date store is the source of truth for anchors (see post-dates.ts). Load once;
  // collect any date a worker resolves from info.json (i.e. not already in the store) so it is
  // frozen here and used directly on every future run, independent of raw/.
  const store = await loadPostDates(handle);
  const discovered: Record<string, string> = {};

  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      const code = f.replace(".json", "");
      const tr = JSON.parse(await readFile(join(transcriptsDir(handle), f), "utf8"));
      const fp = join(framesDir(handle), f);
      const hints = existsSync(fp) ? JSON.parse(await readFile(fp, "utf8")).hints : [];
      const body = `TRANSCRIPT:\n${tr.text}\n\nON-SCREEN HINTS:\n${JSON.stringify(hints)}`;
      // Free local check first: a reel with no upload_date is skipped before the
      // rate-limited LLM call.
      const postDate = await postDateOf(store, handle, code);
      if (postDate == null) {
        console.warn(`skip ${code}: no post date (store or info.json)`);
        results[i] = [];
        continue;
      }
      // Resolved from info.json (absent in the store) -> freeze it.
      if (!(code in store)) discovered[code] = postDate;
      let c;
      try {
        c = await classify(text, body, fireworks);
      } catch (e) {
        // classify() throws "classify: ..." only on an unparseable reply (skip the post).
        // Transport/auth failures (429 past backoff, network, missing FIREWORKS_API_KEY) are
        // NOT per-post and must surface loudly, not silently truncate reel-calls.json.
        if (!(e as Error).message.startsWith("classify:")) throw e;
        console.warn(`skip ${code}: unparseable classify reply — ${(e as Error).message}`);
        results[i] = [];
        continue;
      }
      results[i] = toReelCalls(c, code, postDate);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  if (Object.keys(discovered).length)
    await savePostDates(handle, mergePostDates(store, discovered));

  const out: ReelCall[] = results.flat();
  await writeCalls(handle, out);
  return out;
}
