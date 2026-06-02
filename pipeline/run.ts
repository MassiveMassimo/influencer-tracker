import { scrape, downloadReel } from "./scrape";
import { transcribe } from "./transcribe";
import { frames } from "./frames";
import { extract } from "./extract";
import { prices } from "./prices";
import { score } from "./score";

// Usage: bun run pipeline --handle kevvonz --name "Kevin Hu" [--from <stage>]
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : []
  )
);
const handle = args.handle;
const name = args.name ?? handle;
if (!handle) throw new Error("--handle required");

const stages = ["scrape", "transcribe", "frames", "extract", "prices", "score"];
const start = args.from ? stages.indexOf(args.from) : 0;

for (const stage of stages.slice(start)) {
  console.log(`\n=== ${stage} ===`);
  if (stage === "scrape") {
    const codes = await scrape(handle);
    for (const c of codes) downloadReel(handle, c);
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
