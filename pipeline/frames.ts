import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, framesDir } from "./config";
import { discoverModels } from "./groq";
import { readImage, type FrameHint } from "./vision";

export async function frames(handle: string) {
  const { vision } = await discoverModels();
  await mkdir(framesDir(handle), { recursive: true });
  for (const d of await readdir(rawDir(handle), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    const out = join(framesDir(handle), `${code}.json`);
    if (existsSync(out)) continue;
    const dir = join(rawDir(handle), code);
    const video = (await readdir(dir)).find(f => /\.(mp4|webm|mkv)$/.test(f));
    if (!video) continue;
    // sample 3 frames at 25%, 50%, 75% of duration
    const hints: FrameHint[] = [];
    for (const pct of [0.25, 0.5, 0.75]) {
      const img = join(dir, `f_${pct}.jpg`);
      spawnSync("ffmpeg", ["-y", "-ss", String(pct * 60), "-i", join(dir, video), "-frames:v", "1", img], { stdio: "ignore" });
      if (existsSync(img)) hints.push(await readImage(vision, img));
    }
    await writeFile(out, JSON.stringify({ shortcode: code, hints }, null, 2));
    console.log(`frames ${code}:`, hints);
  }
}
