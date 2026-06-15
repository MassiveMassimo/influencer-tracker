// One-time: convert inline base64 data-URI avatars in data/creators/index.json into
// committed image files data/avatars/<h>.<ext>, and rewrite the index `avatar` field
// to the public path /avatars/<h>.<ext>. Idempotent: entries already holding a path
// (or with no avatar) are left untouched. No re-scrape needed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../pipeline/config";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif",
};

const INDEX = join(ROOT, "data", "creators", "index.json");
const AVATARS = join(ROOT, "data", "avatars");
mkdirSync(AVATARS, { recursive: true });

const idx = JSON.parse(readFileSync(INDEX, "utf8")) as { handle: string; avatar?: string }[];
let migrated = 0;
for (const e of idx) {
  const a = e.avatar;
  if (!a || !a.startsWith("data:")) continue; // already a path or absent
  const m = /^data:([^;]+);base64,(.*)$/s.exec(a);
  if (!m) { console.warn(`skip ${e.handle}: unparseable data URI`); continue; }
  const ext = EXT_BY_MIME[m[1].trim()] ?? "jpg";
  writeFileSync(join(AVATARS, `${e.handle}.${ext}`), Buffer.from(m[2], "base64"));
  e.avatar = `/avatars/${e.handle}.${ext}`;
  migrated++;
}
writeFileSync(INDEX, JSON.stringify(idx, null, 2) + "\n");
console.log(`migrated ${migrated} avatar(s) -> data/avatars/; index.json rewritten`);
