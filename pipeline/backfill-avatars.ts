// One-off: backfill profile pics for creators scraped before avatar capture
// existed. Resolves each creator's avatar without re-scraping their posts, then
// writes data/avatars/<h>.<ext> and patches the index.json entry with the public path.
//
//   bun run pipeline/backfill-avatars.ts [--force] [--handle <h>]
//
// --force re-fetches even when the entry already has an avatar; --handle limits to one.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Rettiwt } from "rettiwt-api";
import { DATA, creatorDir, RETTIWT_KEY } from "./config";
import { saveAvatar } from "./avatar";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? "true"]] : [])),
);
const force = args.force !== undefined;
const only = args.handle as string | undefined;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Platform tell (mirrors the proof-embed logic): numeric shortcode ⇒ X tweet id.
async function detectPlatform(handle: string): Promise<"ig" | "x"> {
  try {
    const ds = JSON.parse(await readFile(join(creatorDir(handle), "dataset.json"), "utf8"));
    const sc = String(ds?.calls?.[0]?.shortcode ?? "");
    if (sc) return /^\d+$/.test(sc) ? "x" : "ig";
  } catch { /* fall through to filesystem heuristic */ }
  return existsSync(join(creatorDir(handle), "cookies.txt")) ? "ig" : "x";
}

// IG web_profile_info, authenticated by the session cookies the scraper persisted
// (Netscape jar). Avoids relaunching the headful browser just to read one URL.
async function resolveIg(handle: string): Promise<string | null> {
  const jar = join(creatorDir(handle), "cookies.txt");
  if (!existsSync(jar)) return null;
  const cookie = (await readFile(jar, "utf8"))
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .filter((f) => f.length >= 7)
    .map((f) => `${f[5]}=${f[6]}`)
    .join("; ");
  const user = handle.replace(/^@/, "");
  const r = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${user}`, {
    headers: { "x-ig-app-id": "936619743392459", cookie, "user-agent": UA },
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j?.data?.user?.profile_pic_url_hd ?? j?.data?.user?.profile_pic_url ?? null;
}

async function resolveX(handle: string): Promise<string | null> {
  if (!RETTIWT_KEY) return null;
  const rettiwt = new Rettiwt({ apiKey: RETTIWT_KEY });
  const details: any = await rettiwt.user.details(handle.replace(/^@/, ""));
  const url: string | undefined = details?.profileImage;
  return url ? url.replace("_normal.", "_400x400.") : null;
}

const path = join(DATA, "index.json");
const idx: any[] = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : [];
let changed = false;

for (const entry of idx) {
  const { handle } = entry;
  if (only && handle !== only) continue;
  if (entry.avatar && !force) { console.log(`skip @${handle} (already has avatar)`); continue; }

  const platform = await detectPlatform(handle);
  let url: string | null = null;
  try {
    url = platform === "ig" ? await resolveIg(handle) : await resolveX(handle);
  } catch (e) {
    console.warn(`resolve fail @${handle} (${platform}): ${(e as Error).message}`);
  }
  const avatarPath = await saveAvatar(handle, url);
  if (avatarPath) {
    entry.avatar = avatarPath;
    changed = true;
    console.log(`✓ @${handle} (${platform}) — ${avatarPath}`);
  } else {
    console.warn(`✗ @${handle} (${platform}) — no avatar resolved`);
  }
}

if (changed) {
  await writeFile(path, JSON.stringify(idx, null, 2) + "\n");
  console.log("index.json updated");
} else {
  console.log("nothing to update");
}
