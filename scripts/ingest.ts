import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { notify, reviewMessage } from "./notify";

const handles = (process.env.INGEST_HANDLES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!handles.length) { console.error("INGEST_HANDLES unset"); process.exit(1); }

async function counts(h: string) {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${h}/reel-calls.json`, "utf8"));
    return { total: rc.length, scored: rc.filter((x: any) => x.isExplicitBuy && x.direction === "bullish").length };
  } catch { return { total: 0, scored: 0 }; }
}

for (const h of handles) {
  try {
    const before = await counts(h);
    const name = JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    await $`bun run pipeline:x --handle ${h} --name ${name} --forward`;   // scrape(forward)+extract, pauses
    const after = await counts(h);
    const fresh = after.total - before.total;
    if (fresh > 0) await notify(reviewMessage(h, fresh, after.scored - before.scored));
    else console.log(`${h}: no new calls`);
  } catch (e) { await notify(`🚨 ingest FAILED ${h}: ${(e as Error).message}`); }
}
