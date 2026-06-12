import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { transcriptsDir, framesDir, rawDir } from "./config";
import { discoverModels } from "./groq";
import { classify, toReelCall, writeCalls } from "./calls";
import type { ReelCall } from "../src/lib/types";

// Pure: format a yt-dlp upload_date (YYYYMMDD) or return null. Exported for tests.
export function formatUploadDate(uploadDate: unknown): string | null {
  if (typeof uploadDate !== "string" || !/^\d{8}$/.test(uploadDate)) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

async function postDateOf(handle: string, code: string): Promise<string | null> {
  // yt-dlp info json: upload_date YYYYMMDD. Null when unknown — the caller skips
  // rather than fabricating a date (a wrong anchor silently corrupts every return).
  const dir = join(rawDir(handle), code);
  if (!existsSync(dir)) return null;
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    return formatUploadDate(j.upload_date);
  }
  return null;
}

export async function extract(handle: string) {
  const { text } = await discoverModels();
  const out: ReelCall[] = [];
  for (const f of await readdir(transcriptsDir(handle))) {
    if (!f.endsWith(".json")) continue;
    const code = f.replace(".json", "");
    const tr = JSON.parse(await readFile(join(transcriptsDir(handle), f), "utf8"));
    const fp = join(framesDir(handle), f);
    const hints = existsSync(fp) ? JSON.parse(await readFile(fp, "utf8")).hints : [];
    const body = `TRANSCRIPT:\n${tr.text}\n\nON-SCREEN HINTS:\n${JSON.stringify(hints)}`;
    let c;
    try {
      c = await classify(text, body);
    } catch (e) {
      console.warn(`skip ${code}: classify failed — ${(e as Error).message}`);
      continue;
    }
    const postDate = await postDateOf(handle, code);
    if (postDate == null) { console.warn(`skip ${code}: no upload_date in info.json`); continue; }
    const rc = toReelCall(c, code, postDate);
    if (rc) out.push(rc);
  }
  await writeCalls(handle, out);
  return out;
}
