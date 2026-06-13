import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { rawDir, transcriptsDir } from "./config";

// Self-hosted Parakeet ASR (onnx-asr, CPU) replaces Groq Whisper: no external
// API, no rate limits, runs on the VM. The model load + decode lives in a Python
// venv (onnx-asr isn't available for bun), so transcribe extracts wavs and shells
// the whole batch to one Python process that loads the model once.
const SCRIPT = join(import.meta.dir, "asr", "transcribe_parakeet.py");

// venv interpreter with onnx-asr installed. Override with PARAKEET_PYTHON; else
// the conventional ~/asr-venv, else bare python3 (must have onnx-asr importable).
function parakeetPython(): string {
  if (process.env.PARAKEET_PYTHON) return process.env.PARAKEET_PYTHON;
  const venv = join(homedir(), "asr-venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

export async function transcribe(handle: string) {
  await mkdir(transcriptsDir(handle), { recursive: true });

  // Extract 16 kHz mono wav per un-transcribed reel (Parakeet's expected input).
  const jobs: [string, string][] = []; // [code, wavPath]
  for (const d of await readdir(rawDir(handle), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    if (existsSync(join(transcriptsDir(handle), `${code}.json`))) continue; // idempotent
    const dir = join(rawDir(handle), code);
    const video = (await readdir(dir)).find(f => /\.(mp4|webm|mkv)$/.test(f));
    if (!video) { console.warn(`skip ${code}: no video`); continue; }
    const wav = join(dir, "audio.wav");
    spawnSync("ffmpeg", ["-y", "-i", join(dir, video), "-vn", "-ar", "16000", "-ac", "1", wav], { stdio: "ignore" });
    // ffmpeg emits nothing for a video with no audio track; skip rather than crash.
    if (existsSync(wav)) jobs.push([code, wav]);
    else console.warn(`skip ${code}: no audio track`);
  }
  if (!jobs.length) return;

  // One Python invocation loads the model once and transcribes the whole batch.
  const r = spawnSync(parakeetPython(), [SCRIPT], {
    input: JSON.stringify(jobs),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  // A nonzero exit is a setup/transport failure (missing venv, bad model) — NOT
  // per-file — and must surface loudly, not silently truncate transcripts.
  if (r.status !== 0) throw new Error(`parakeet transcribe failed: ${r.stderr || r.error?.message || "unknown"}`);

  const texts: Record<string, string> = JSON.parse(r.stdout);
  for (const [code] of jobs) {
    const text = texts[code];
    if (text == null) { console.warn(`skip ${code}: no transcript returned`); continue; }
    await writeFile(join(transcriptsDir(handle), `${code}.json`), JSON.stringify({ shortcode: code, text }, null, 2));
    console.log(`transcribed ${code}`);
  }
}
