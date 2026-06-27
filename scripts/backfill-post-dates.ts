import { readFile, readdir } from "node:fs/promises";
import { majorityNumeric } from "./shortcodes";
import { loadPostDates, savePostDates, mergePostDates } from "../pipeline/post-dates";

// Pure: build {shortcode: postDate} from a dataset's calls, deduped by shortcode (a multi-ticker
// post repeats its shortcode with one shared date). Drops entries missing either field.
export function postDatesFromDataset(
  calls: { shortcode?: unknown; postDate?: unknown }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of calls) {
    const code = String(c.shortcode ?? "");
    const date = String(c.postDate ?? "");
    if (code && date && !(code in out)) out[code] = date;
  }
  return out;
}

// Seed the durable store for every IG creator (non-numeric shortcodes) from its committed
// dataset.json. Idempotent: existing-wins merge means a re-run never changes a frozen date.
async function main() {
  const creatorsDir = "data/creators";
  const entries = await readdir(creatorsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const handle = e.name;
    let calls: { shortcode?: unknown; postDate?: unknown }[];
    try {
      const ds = JSON.parse(await readFile(`${creatorsDir}/${handle}/dataset.json`, "utf8"));
      calls = ds.calls ?? [];
    } catch {
      console.log(`skip ${handle}: no readable dataset.json`);
      continue;
    }
    const codes = calls.map((c) => String(c.shortcode ?? "")).filter(Boolean);
    if (majorityNumeric(codes)) {
      console.log(`skip ${handle}: X creator (numeric shortcodes)`);
      continue;
    }
    const seeded = postDatesFromDataset(calls);
    const merged = mergePostDates(await loadPostDates(handle), seeded);
    await savePostDates(handle, merged);
    console.log(
      `seeded ${handle}: ${Object.keys(seeded).length} dates -> store has ${Object.keys(merged).length}`,
    );
  }
}

if (import.meta.main) await main();
