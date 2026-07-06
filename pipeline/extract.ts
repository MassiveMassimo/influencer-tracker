import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { transcriptsDir, framesDir, rawDir, creatorDir } from "./config";
import { fireworks, FIREWORKS_MODEL } from "./fireworks";
import { classify, toReelCalls, writeCalls } from "./calls";
import { loadPostDates, savePostDates, mergePostDates } from "./post-dates";
import type { ReelCall } from "../src/lib/types";

// Pure: format a yt-dlp upload_date (YYYYMMDD) or return null. Exported for tests.
export function formatUploadDate(uploadDate: unknown): string | null {
  if (typeof uploadDate !== "string" || !/^\d{8}$/.test(uploadDate)) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

// Durable fallback anchor source: a reel that produced a call has its postDate frozen in the
// committed dataset.json (survives raw/ purge + the VM's `git checkout -- data/`). Recovers the
// anchor when the store misses AND info.json is gone, so a previously-scored reel is re-classified
// rather than silently dropped from reel-calls.json. Fail-open ({}) on a missing/unparseable file.
export async function loadDatasetAnchors(handle: string): Promise<Record<string, string>> {
  try {
    const ds = JSON.parse(await readFile(join(creatorDir(handle), "dataset.json"), "utf8"));
    const out: Record<string, string> = {};
    for (const c of ds.calls ?? []) if (c?.shortcode && c?.postDate) out[c.shortcode] = c.postDate;
    return out;
  } catch {
    return {};
  }
}

// Durable store WINS: the anchor must not flip based on whether raw/ is present this run
// (that would silently restate forward returns). info.json is only a gap-filler for a reel
// not yet in the store; the caller freezes that resolved date back into the store. A prior
// dataset.json anchor is the last durable fallback when raw/ (info.json) has been purged. Null
// only when all miss — skip rather than fabricate (a wrong anchor silently corrupts every return).
export async function postDateOf(
  store: Record<string, string>,
  datasetAnchors: Record<string, string>,
  handle: string,
  code: string,
): Promise<string | null> {
  if (store[code]) return store[code];
  const dir = join(rawDir(handle), code);
  if (existsSync(dir)) {
    const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
    if (info) {
      const j = JSON.parse(await readFile(join(dir, info), "utf8"));
      const d = formatUploadDate(j.upload_date);
      if (d) return d;
    }
  }
  return datasetAnchors[code] ?? null;
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
  const datasetAnchors = await loadDatasetAnchors(handle);
  const discovered: Record<string, string> = {};
  // Transcribed reels with no resolvable anchor: their calls are dropped this run. Collected for
  // a single loud summary — the sub-guard-threshold tripwire guard-no-shrink can't see (< 5%).
  const dateless: string[] = [];

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
      const postDate = await postDateOf(store, datasetAnchors, handle, code);
      if (postDate == null) {
        dateless.push(code);
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

  // Loud, aggregated tripwire: a dateless transcribed reel had its calls dropped from
  // reel-calls.json with no anchor recovered (store + info.json + dataset.json all missed).
  if (dateless.length)
    console.warn(
      `extract ${handle}: ${dateless.length} transcribed reel(s) with no resolvable post date — ` +
        `their calls are NOT in reel-calls.json: ${dateless.join(", ")}`,
    );

  const out: ReelCall[] = results.flat();
  await writeCalls(handle, out);
  return out;
}
