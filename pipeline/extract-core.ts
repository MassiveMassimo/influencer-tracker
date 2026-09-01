import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { creatorDir } from "./config";
import { toReelCalls, writeCalls, type Classification } from "./calls";
import type { ReelCall } from "../src/lib/types";

// A post to extract from — platform-agnostic. The adapter resolves text + visual
// hints into the body string; the core handles classification + ReelCall mapping.
export interface ExtractPost {
  shortcode: string;
  postDate: string;
  body: string;
}

// Resolve a shortcode to an ExtractPost (read transcript, resolve hints + date, build
// body). A null result is incomplete input, so the core keeps it pending and records
// a retryable failure instead of silently marking the post done.
export type BuildPost = (shortcode: string) => Promise<ExtractPost | null>;

export const callKey = (c: ReelCall): string => `${c.shortcode}:${c.ticker}`;

interface ExtractFailure {
  shortcode: string;
  attempts: number;
  lastError: string;
  updatedAt: string;
}

// Collapse duplicate calls by (shortcode, ticker), keeping the first occurrence.
// Guards against a crash between checkpoint writes re-appending a call.
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

// Shared extraction engine: resume from extract-done.json, deduplicate existing calls,
// classify only new posts with a heal-loop for transient errors, and persist
// checkpoints. Both IG and X adapters delegate here — the only platform-specific
// logic is the BuildPost callback that resolves a shortcode to a body + date.
export async function extractPosts(
  handle: string,
  shortcodes: string[],
  buildPost: BuildPost,
  opts: {
    concurrency: number;
    donePath: string;
    failurePath?: string;
    classifyFn: (body: string) => Promise<Classification[]>;
  },
): Promise<ReelCall[]> {
  // Load existing calls (preserved across runs) + done set (resume tracking).
  const callsPath = join(creatorDir(handle), "reel-calls.json");
  const loaded: ReelCall[] = existsSync(callsPath)
    ? JSON.parse(await readFile(callsPath, "utf8"))
    : [];
  const out: ReelCall[] = dedupeCalls(loaded);
  const seenCalls = new Set(out.map(callKey));

  let done: Set<string>;
  if (!existsSync(opts.donePath)) {
    if (loaded.length > 0) {
      // First run with resume support: seed done ONLY from posts that already
      // produced a call. Those are frozen — never re-classified, since LLM
      // non-determinism would drift the scored call set. Every other post (a
      // genuinely no-call post, or a reel scraped but never classified) flows
      // through classification once and is then persisted as done, so the seed
      // recovers missed posts instead of swallowing them, and can only ADD calls.
      done = new Set(out.map((c) => c.shortcode));
      // Persist the seed immediately: if every post is already called, pending is
      // empty and the early return below fires before persist() ever runs — so
      // without this write the file is never created and every run re-seeds.
      await writeFile(opts.donePath, JSON.stringify([...done]));
      console.log(
        `seeded extract-done.json: ${done.size} called posts of ${shortcodes.length}; ` +
          `${shortcodes.length - done.size} to classify`,
      );
    } else {
      done = new Set();
    }
  } else {
    done = new Set(JSON.parse(await readFile(opts.donePath, "utf8")) as string[]);
  }

  const failurePath = opts.failurePath ?? join(dirname(opts.donePath), "extract-failures.json");
  await mkdir(dirname(failurePath), { recursive: true });
  const loadedFailures: ExtractFailure[] = existsSync(failurePath)
    ? JSON.parse(await readFile(failurePath, "utf8"))
    : [];
  const failures = new Map(loadedFailures.map((failure) => [failure.shortcode, failure]));
  for (const shortcode of done) failures.delete(shortcode);

  const pending = shortcodes.filter((sc) => !done.has(sc));
  if (!pending.length) {
    await writeFile(failurePath, JSON.stringify([...failures.values()], null, 2));
    console.log(`nothing to extract — all ${shortcodes.length} posts already done`);
    return out;
  }

  console.log(`resuming: ${done.size} done, ${pending.length} pending, ${out.length} calls so far`);

  // Serialize checkpoint writes so overlapping workers never clobber the files.
  let writeChain: Promise<void> = Promise.resolve();
  const persist = () => {
    writeChain = writeChain.then(async () => {
      await writeCalls(handle, out);
      await writeFile(opts.donePath, JSON.stringify([...done]));
      await writeFile(failurePath, JSON.stringify([...failures.values()], null, 2));
    });
    return writeChain;
  };

  let completed = 0;

  // Heal-loop: a post that throws (e.g. a 429 that outlives backoff) is NOT
  // marked done, so the next pass retries it. As the leftover set shrinks below
  // CONCURRENCY the effective parallelism drops, clearing the rate-limit wall.
  for (let pass = 1; ; pass++) {
    const stillPending = shortcodes.filter((sc) => !done.has(sc));
    if (!stillPending.length) break;
    const before = done.size;
    if (pass > 1) console.log(`heal pass ${pass}: ${stillPending.length} left`);
    let next = 0;

    const worker = async () => {
      while (next < stillPending.length) {
        const sc = stillPending[next++];
        try {
          const post = await buildPost(sc);
          if (!post) {
            throw new Error("adapter returned no extractable post");
          }
          const cs = await opts.classifyFn(post.body);
          for (const rc of toReelCalls(cs, post.shortcode, post.postDate)) {
            if (seenCalls.has(callKey(rc))) continue;
            seenCalls.add(callKey(rc));
            out.push(rc);
          }
          done.add(sc);
          failures.delete(sc);
        } catch (e) {
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
          const previous = failures.get(sc);
          failures.set(sc, {
            shortcode: sc,
            attempts: (previous?.attempts ?? 0) + 1,
            lastError: message,
            updatedAt: new Date().toISOString(),
          });
          console.warn(`skip ${sc}: ${message}`);
        }
        if (++completed % 20 === 0) {
          await persist();
          console.log(`extracted ${done.size}/${shortcodes.length} posts -> ${out.length} calls`);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(opts.concurrency, stillPending.length) }, worker),
    );
    await persist();
    if (done.size === before) {
      console.warn(`no progress on ${stillPending.length} posts; giving up`);
      break;
    }
  }

  const unresolved = shortcodes.filter((sc) => !done.has(sc));
  if (unresolved.length) {
    throw new Error(
      `extraction incomplete: ${unresolved.length} post(s) remain; see ${failurePath}`,
    );
  }

  console.log(`extracted ${done.size}/${shortcodes.length} posts -> ${out.length} calls`);
  return out;
}
