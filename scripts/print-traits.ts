// Prints earned trait ids per committed creator dataset. Threshold-tuning aid for
// src/lib/traits.ts — run after changing any trait constant.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "../src/lib/types";
import { traitsFor } from "../src/lib/traits";

const root = join(import.meta.dir, "..", "data", "creators");
for (const h of readdirSync(root)) {
  const p = join(root, h, "dataset.json");
  if (!existsSync(p)) continue;
  const ds = JSON.parse(readFileSync(p, "utf8")) as Dataset;
  const ids = traitsFor(ds.calls).map((t) => t.id);
  console.log(`${h.padEnd(22)} ${ids.join(", ") || "—"}`);
}
