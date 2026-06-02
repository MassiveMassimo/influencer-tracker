import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, transcriptsDir } from "./config";
import { groq, discoverModels } from "./groq";

async function transcribeOne(stt: string, videoPath: string): Promise<any> {
  const mp3 = videoPath.replace(/\.[^.]+$/, ".mp3");
  spawnSync("ffmpeg", ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", mp3], { stdio: "ignore" });
  // ffmpeg emits nothing for video with no audio track; skip rather than crash.
  if (!existsSync(mp3)) return null;
  const fd = new FormData();
  fd.append("file", new Blob([await readFile(mp3)]), "audio.mp3");
  fd.append("model", stt);
  fd.append("response_format", "verbose_json");
  return (await groq("/audio/transcriptions", { method: "POST", body: fd })).json();
}

export async function transcribe(handle: string) {
  const { stt } = await discoverModels();
  await mkdir(transcriptsDir(handle), { recursive: true });
  const codes = await readdir(rawDir(handle), { withFileTypes: true });
  for (const d of codes) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    const outPath = join(transcriptsDir(handle), `${code}.json`);
    if (existsSync(outPath)) continue; // idempotent
    const dir = join(rawDir(handle), code);
    const files = await readdir(dir);
    const video = files.find(f => /\.(mp4|webm|mkv)$/.test(f));
    if (!video) { console.warn(`skip ${code}: no video`); continue; }
    try {
      const t = await transcribeOne(stt, join(dir, video));
      if (!t) { console.warn(`skip ${code}: no audio track`); continue; }
      await writeFile(outPath, JSON.stringify({ shortcode: code, text: t.text, segments: t.segments }, null, 2));
      console.log(`transcribed ${code}`);
    } catch (e) {
      console.warn(`skip ${code}: ${(e as Error).message}`);
    }
  }
}
