import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, framesDir } from "./config";
import { llm, VISION_MODEL, assertLlmKey } from "./llm";
import { readImage, type FrameHint } from "./vision";

// Real video duration in seconds, or null if it can't be determined.
// Prefer the yt-dlp sidecar (<id>.info.json `duration`); else probe with ffprobe.
function videoDuration(dir: string, video: string): number | null {
  try {
    const info = readdirSync(dir).find((f) => f.endsWith(".info.json"));
    if (info) {
      const d = JSON.parse(readFileSync(join(dir, info), "utf8")).duration;
      if (typeof d === "number" && d > 0) return d;
    }
  } catch {
    // fall through to ffprobe
  }
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nokey=1:noprint_wrapper=1",
      join(dir, video),
    ],
    { encoding: "utf8" },
  );
  const d = Number.parseFloat((probe.stdout ?? "").trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

// Vision OCR runs on the shared LLM client (Gemini; like the X path). Transcribe is
// self-hosted Parakeet, not this client.
export async function frames(handle: string) {
  assertLlmKey(); // fail loud before per-frame reads silently degrade to null hints
  const vision = VISION_MODEL;
  await mkdir(framesDir(handle), { recursive: true });
  for (const d of await readdir(rawDir(handle), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    const out = join(framesDir(handle), `${code}.json`);
    if (existsSync(out)) continue;
    const dir = join(rawDir(handle), code);
    const video = (await readdir(dir)).find((f) => /\.(mp4|webm|mkv)$/.test(f));
    if (!video) continue;
    // sample 3 frames at 25%, 50%, 75% of real duration (fail-open to 60s if unknown)
    const duration = videoDuration(dir, video) ?? 60;
    const hints: FrameHint[] = [];
    for (const pct of [0.25, 0.5, 0.75]) {
      const img = join(dir, `f_${pct}.jpg`);
      spawnSync(
        "ffmpeg",
        ["-y", "-ss", String(pct * duration), "-i", join(dir, video), "-frames:v", "1", img],
        { stdio: "ignore" },
      );
      if (existsSync(img)) hints.push(await readImage(vision, img, llm));
    }
    await writeFile(out, JSON.stringify({ shortcode: code, hints }, null, 2));
    console.log(`frames ${code}:`, hints);
  }
}
