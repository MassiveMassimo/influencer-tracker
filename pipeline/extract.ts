import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { transcriptsDir, framesDir, rawDir } from "./config";
import { discoverModels } from "./groq";
import { classify, toReelCall, writeCalls } from "./calls";
import type { ReelCall } from "../src/lib/types";

async function postDateOf(handle: string, code: string): Promise<string> {
  // yt-dlp info json: upload_date YYYYMMDD
  const dir = join(rawDir(handle), code);
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    if (j.upload_date) return `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}`;
  }
  return new Date().toISOString().slice(0, 10);
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
    const rc = toReelCall(c, code, await postDateOf(handle, code));
    if (rc) out.push(rc);
  }
  await writeCalls(handle, out);
  return out;
}
