import { Rettiwt } from "rettiwt-api";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rawDir, RETTIWT_KEY } from "../config";
import { withRetry } from "../retry";
import { saveAvatar } from "../avatar";

export interface TweetRecord {
  id: string;
  createdAt: string; // ISO
  text: string;
  imageUrls: string[];
}

// X's tweet.search cap is ~50 requests / 15 min per account (≈1 per 18s). Pace
// every Rettiwt request ~20-26s via the client's built-in `delay` so the bucket
// never drains — exponential backoff can't beat a fixed 15-min reset window.
const REQUEST_DELAY = () => 20000 + Math.random() * 6000;

// Persist incrementally so a mid-scrape death (rate-limit, crash) keeps progress
// and the next run can resume instead of restarting.
async function persist(handle: string, records: TweetRecord[]): Promise<void> {
  await mkdir(rawDir(handle), { recursive: true });
  await writeFile(join(rawDir(handle), "tweets.json"), JSON.stringify(records, null, 2));
  await writeFile(join(rawDir(handle), "shortcodes.json"), JSON.stringify(records.map((r) => r.id), null, 2));
}

async function loadExisting(handle: string): Promise<TweetRecord[]> {
  try { return JSON.parse(await readFile(join(rawDir(handle), "tweets.json"), "utf8")) as TweetRecord[]; }
  catch { return []; }
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

// Resolve the X avatar via user details; bump the default _normal (48px) variant
// to 400px. Best-effort — saveAvatar tolerates a null URL.
async function resolveAvatarUrl(rettiwt: Rettiwt, user: string): Promise<string | null> {
  try {
    const details: any = await withRetry(() => rettiwt.user.details(user),
      { label: "x.user", isRetryable: isTransient, retries: 4, delayMs: (a) => Math.min(2 ** a, 30) * 1000 });
    const url: string | undefined = details?.profileImage;
    return url ? url.replace("_normal.", "_400x400.") : null;
  } catch { return null; }
}

// Fetch a creator's original tweets over the last `months` and download images.
// X search caps a single query's reachable depth (~3,200), so we walk backwards
// in time windows (endDate = oldest seen) to cover the full range, deduping by id.
export async function scrapeX(handle: string, months = 12): Promise<TweetRecord[]> {
  if (!RETTIWT_KEY) throw new Error("RETTIWT_API_KEY not set (use a throwaway X account key)");
  const rettiwt = new Rettiwt({ apiKey: RETTIWT_KEY, delay: REQUEST_DELAY });
  const user = handle.replace(/^@/, "");
  const cutoff = new Date(Date.now() - months * 30 * 86400_000);

  // Resume: seed from any prior partial run and continue older than what we have.
  const records: TweetRecord[] = await loadExisting(handle);
  const seen = new Set<string>(records.map((r) => r.id));
  let windowEnd = records.length
    ? new Date(Math.min(...records.map((r) => new Date(r.createdAt).getTime())) - 1000)
    : new Date();
  if (records.length) {
    console.log(`resuming with ${records.length} tweets; continuing older than ${windowEnd.toISOString().slice(0, 10)}`);
  }
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
      // Built-in `delay` paces this; withRetry is a backstop for the occasional
      // 404/5xx and for riding out a 429 if the bucket is still cooling down.
      const data: any = await withRetry(
        () => rettiwt.tweet.search(filter as any, 20, cursor),
        { label: `x.search w${w}`, isRetryable: isTransient, retries: 10, delayMs: (a) => Math.min(2 ** a, 120) * 1000 },
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
    await persist(handle, records); // checkpoint after each window
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
  await persist(handle, records); // final checkpoint (incl. any newly downloaded images)
  await saveAvatar(handle, await resolveAvatarUrl(rettiwt, user));
  if (incomplete) console.warn(`COVERAGE: hit window cap for @${user}; oldest tweets may be missing`);
  console.log(`scraped ${records.length} tweets for @${user}`);
  return records;
}
