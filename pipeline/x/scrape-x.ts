import { Rettiwt } from "rettiwt-api";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rawDir, RETTIWT_KEY } from "../config";
import { withRetry } from "../retry";

export interface TweetRecord {
  id: string;
  createdAt: string; // ISO
  text: string;
  imageUrls: string[];
}

// Rettiwt's MediaType enum uses uppercase ("PHOTO"); match case-insensitively
// and keep a URL-extension fallback for safety.
const PHOTO = (m: any) =>
  String(m?.type).toUpperCase() === "PHOTO" || /\.(jpe?g|png)/i.test(m?.url ?? "");

// Pure: map a Rettiwt tweet to our record, keeping only image media.
export function toRecord(t: any): TweetRecord {
  const imageUrls = (t.media ?? []).filter(PHOTO).map((m: any) => m.url).filter(Boolean);
  return {
    id: String(t.id),
    createdAt: new Date(t.createdAt).toISOString(),
    text: t.fullText ?? "",
    imageUrls,
  };
}

export function isRateLimit(e: unknown): boolean {
  return /rate.?limit|too many|429/i.test(String((e as Error)?.message ?? e));
}

// Transient API failures worth retrying: rate limits, 5xx, and the 404s X
// load-sheds with during deep pagination. Capped retries bound a real 404.
export function isTransient(e: unknown): boolean {
  const s = (e as any)?.response?.status ?? (e as any)?.status;
  if (s === 429 || s === 404 || (typeof s === "number" && s >= 500 && s < 600)) return true;
  return /rate.?limit|too many|429|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(String((e as Error)?.message ?? e));
}

async function downloadImage(url: string, dest: string): Promise<void> {
  // Only fetch https URLs; this runs unattended against API-supplied URLs.
  if (new URL(url).protocol !== "https:") return;
  const res = await withRetry(() => fetch(url), { label: "img", isRetryable: isTransient, delayMs: () => 2000 });
  if (!res.ok) return;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// Fetch a creator's original tweets over the last `months` and download images.
// X search caps a single query's reachable depth (~3,200), so we walk backwards
// in time windows (endDate = oldest seen) to cover the full range, deduping by id.
export async function scrapeX(handle: string, months = 12): Promise<TweetRecord[]> {
  if (!RETTIWT_KEY) throw new Error("RETTIWT_API_KEY not set (use a throwaway X account key)");
  const rettiwt = new Rettiwt({ apiKey: RETTIWT_KEY });
  const user = handle.replace(/^@/, "");
  const cutoff = new Date(Date.now() - months * 30 * 86400_000);

  const seen = new Set<string>();
  const records: TweetRecord[] = [];
  let windowEnd = new Date();
  let incomplete = false;
  const WINDOW_CAP = 80;
  let w = 0;
  for (; w < WINDOW_CAP; w++) {
    // Search returns newest-first within [cutoff, windowEnd].
    const filter = { fromUsers: [user], onlyOriginal: true, startDate: cutoff, endDate: windowEnd };
    let cursor: string | undefined;
    let oldest = windowEnd.getTime();
    let added = 0;
    for (let page = 0; page < 400; page++) {
      const data: any = await withRetry(
        () => rettiwt.tweet.search(filter as any, 20, cursor),
        { label: `x.search w${w}`, isRetryable: isTransient, retries: 6, delayMs: (a) => Math.min(2 ** a, 30) * 1000 },
      );
      for (const t of data.list ?? []) {
        const rec = toRecord(t);
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        records.push(rec);
        added++;
        const tm = new Date(rec.createdAt).getTime();
        if (tm < oldest) oldest = tm;
      }
      if (!data.next || !data.list?.length) break;
      cursor = data.next;
    }
    if (oldest <= cutoff.getTime()) break; // reached the cutoff boundary
    if (added === 0) break;                // no new tweets older than this window
    windowEnd = new Date(oldest - 1000);   // step the window back past the oldest seen
    console.log(`scraped ${records.length} tweets so far; older than ${new Date(oldest).toISOString().slice(0, 10)}`);
  }
  if (w >= WINDOW_CAP) incomplete = true;

  await mkdir(rawDir(handle), { recursive: true });
  for (const r of records) {
    for (let i = 0; i < r.imageUrls.length; i++) {
      try { await downloadImage(r.imageUrls[i], join(rawDir(handle), r.id, `img_${i}.jpg`)); }
      catch (e) { console.warn(`img fail ${r.id}: ${(e as Error).message}`); }
    }
  }
  await writeFile(join(rawDir(handle), "tweets.json"), JSON.stringify(records, null, 2));
  // Parity with the IG path: score.ts reads shortcodes.json for the scraped count.
  await writeFile(join(rawDir(handle), "shortcodes.json"), JSON.stringify(records.map((r) => r.id), null, 2));
  if (incomplete) console.warn(`COVERAGE: hit window cap for @${user}; oldest tweets may be missing`);
  console.log(`scraped ${records.length} tweets for @${user}`);
  return records;
}
