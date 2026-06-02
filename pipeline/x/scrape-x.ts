import { Rettiwt } from "rettiwt-api";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, RETTIWT_KEY } from "../config";
import { withRetry } from "../retry";

export interface TweetRecord {
  id: string;
  createdAt: string; // ISO
  text: string;
  imageUrls: string[];
}

const PHOTO = (m: any) => m?.type === "photo" || m?.type === "image" || /\.(jpe?g|png)/i.test(m?.url ?? "");

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

async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await withRetry(() => fetch(url), { label: "img", isRetryable: isRateLimit, delayMs: () => 2000 });
  if (!res.ok) return;
  await mkdir(join(dest, ".."), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// Fetch a creator's original tweets over the last `months` and download images.
// X caps a user's reachable history near ~3,200 tweets; we log if truncated.
export async function scrapeX(handle: string, months = 12): Promise<TweetRecord[]> {
  if (!RETTIWT_KEY) throw new Error("RETTIWT_API_KEY not set (use a throwaway X account key)");
  const rettiwt = new Rettiwt({ apiKey: RETTIWT_KEY });
  const user = handle.replace(/^@/, "");
  const cutoff = new Date(Date.now() - months * 30 * 86400_000);
  const filter = { fromUsers: [user], onlyOriginal: true, startDate: cutoff, endDate: new Date() };

  const records: TweetRecord[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < 250; page++) {
    const data: any = await withRetry(
      () => rettiwt.tweet.search(filter as any, 20, cursor),
      { label: "x.search", isRetryable: isRateLimit, delayMs: (a) => Math.min(2 ** a, 30) * 1000 },
    );
    records.push(...(data.list ?? []).map(toRecord));
    if (!data.next || !data.list?.length) break;
    cursor = data.next;
    if (records.length >= 3200) { truncated = true; break; }
  }

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
  if (truncated) console.warn(`COVERAGE: hit ~3200-tweet ceiling for @${user}; older tweets may be missing`);
  console.log(`scraped ${records.length} tweets for @${user}`);
  return records;
}
