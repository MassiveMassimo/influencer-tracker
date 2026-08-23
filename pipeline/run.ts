import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoDownloadFailures,
  clearDownloadFailure,
  downloadReel,
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

// Usage: bun run pipeline --handle kevvonz --name "Kevin Hu" [--from <stage>]
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const handle = args.handle;
const name = args.name ?? handle;
if (!handle) throw new Error("--handle required");

const stages = ["scrape", "transcribe", "frames", "extract", "prices", "score"];
const start = args.from ? stages.indexOf(args.from) : 0;

for (const stage of stages.slice(start)) {
  console.log(`\n=== ${stage} ===`);
  if (stage === "scrape") {
    const codes = await scrape(handle, 12, { forward: "forward" in args });
    const retries = (await loadDownloadFailures(handle)).map((failure) => failure.shortcode);
    // Skip reels already transcribed: the transcript is the durable artifact, so
    // raw media is disposable and never re-fetched. Keeps re-runs of an existing
    // creator to new reels only.
    for (const c of new Set([...codes, ...retries])) {
      if (existsSync(join(transcriptsDir(handle), `${c}.json`))) {
        await clearDownloadFailure(handle, c);
        continue;
      }
      // downloadReel throws if yt-dlp cannot launch (fatal environment fault).
      // Per-reel failures remain in a durable retry queue until a download succeeds.
      const result = downloadReel(handle, c);
      if (!result.ok) {
        await recordDownloadFailure(handle, c, result.reason);
        console.warn(`download pending ${c}: ${result.reason}`);
      } else {
        await clearDownloadFailure(handle, c);
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
