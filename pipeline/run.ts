import { existsSync } from "node:fs";
import { join } from "node:path";
import { scrape, downloadReel } from "./scrape";
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
    // Skip reels already transcribed: the transcript is the durable artifact, so
    // raw media is disposable and never re-fetched. Keeps re-runs of an existing
    // creator to new reels only.
    for (const c of codes) {
      if (existsSync(join(transcriptsDir(handle), `${c}.json`))) continue;
      // downloadReel throws if yt-dlp can't launch (fatal env fault); a false return is a
      // benign per-reel miss (image/carousel post, no video) — log it and move on.
      if (!downloadReel(handle, c))
        console.warn(`skip download ${c}: no video (image post?) or download failed`);
    }
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
