import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoDownloadFailures,
  clearDownloadFailure,
  downloadInstagramMedia,
  loadDownloadFailures,
  recordDownloadFailure,
  scrape,
} from "./scrape";
import { transcribe } from "./transcribe";
import { frames } from "./frames";
import { extract } from "./extract";
import { prices } from "./prices";
import { score } from "./score";
import { transcriptsDir } from "./config";

// Usage: bun run pipeline --handle kevvonz --name "Kevin Hu" [--months 12] [--from <stage>]
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const handle = args.handle;
const name = args.name ?? handle;
if (!handle) throw new Error("--handle required");
const months = args.months === undefined ? 12 : Number(args.months);
if (!Number.isFinite(months) || months <= 0) {
  throw new Error("--months must be a positive number");
}

const stages = ["scrape", "transcribe", "frames", "extract", "prices", "score"];
const start = args.from ? stages.indexOf(args.from) : 0;

for (const stage of stages.slice(start)) {
  console.log(`\n=== ${stage} ===`);
  if (stage === "scrape") {
    const codes = await scrape(handle, months, { forward: "forward" in args });
    const retries = (await loadDownloadFailures(handle)).map((failure) => ({
      shortcode: failure.shortcode,
      kind: failure.kind ?? ("reel" as const),
    }));
    // Skip posts already transcribed: the transcript is the durable artifact, so
    // raw media is disposable and never re-fetched. Keeps re-runs of an existing
    // creator to new posts only.
    const media = new Map([...codes, ...retries].map((item) => [item.shortcode, item]));
    for (const item of media.values()) {
      if (existsSync(join(transcriptsDir(handle), `${item.shortcode}.json`))) {
        await clearDownloadFailure(handle, item.shortcode);
        continue;
      }
      // downloadInstagramMedia throws if yt-dlp cannot launch (fatal environment fault).
      // Per-post failures remain in a durable retry queue until a download succeeds.
      const result = downloadInstagramMedia(handle, item);
      if (!result.ok) {
        await recordDownloadFailure(handle, item.shortcode, item.kind, result.reason);
        console.warn(`download pending ${item.shortcode}: ${result.reason}`);
      } else {
        await clearDownloadFailure(handle, item.shortcode);
      }
    }
    assertNoDownloadFailures(await loadDownloadFailures(handle));
  } else if (stage === "transcribe") {
    await transcribe(handle);
  } else if (stage === "frames") {
    await frames(handle);
  } else if (stage === "extract") {
    await extract(handle);
    console.log("PAUSE: review calls.review.md then re-run with --from prices");
    break;
  } else if (stage === "prices") {
    await prices(handle);
  } else if (stage === "score") {
    await score(handle, name);
  }
}
