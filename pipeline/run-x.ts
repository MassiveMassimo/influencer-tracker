import { scrapeX } from "./x/scrape-x";
import { extractX } from "./x/extract-x";
import { prices } from "./prices";
import { score } from "./score";

// Usage: bun run pipeline:x --handle TheProfInvestor --name "The Prof Investor" [--from <stage>]
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const handle = args.handle;
const name = args.name ?? handle;
if (!handle) throw new Error("--handle required");

const stages = ["scrape", "extract", "prices", "score"];
const start = args.from ? stages.indexOf(args.from) : 0;

for (const stage of stages.slice(start)) {
  console.log(`\n=== ${stage} ===`);
  if (stage === "scrape") {
    await scrapeX(handle, 12, { forward: "forward" in args });
  } else if (stage === "extract") {
    await extractX(handle);
    console.log("PAUSE: review calls.review.md then re-run with --from prices");
    break;
  } else if (stage === "prices") {
    await prices(handle);
  } else if (stage === "score") {
    await score(handle, name, undefined, "Tweets"); // X posts are tweets, not reels
  }
}
