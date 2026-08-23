import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { rawDir, transcriptsDir } from "./config";

// Self-hosted Parakeet ASR (onnx-asr, CPU) replaces Groq Whisper: no external
// API, no rate limits, runs on the VM. The model load + decode lives in a Python
// venv (onnx-asr isn't available for bun), so transcribe extracts wavs and shells
// the whole batch to one Python process that loads the model once.
const SCRIPT = join(import.meta.dir, "asr", "transcribe_parakeet.py");

export function captionFromInfo(info: unknown): string {
  if (!info || typeof info !== "object") return "";
  const description = (info as { description?: unknown }).description;
  return typeof description === "string" ? description.trim() : "";
}

export function combineTranscript(caption: string, audio: string): string {
  return [
    caption.trim() ? `CAPTION:\n${caption.trim()}` : "",
    audio.trim() ? `AUDIO:\n${audio.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function captionFromDirectory(dir: string): Promise<string> {
  const captions = new Set<string>();
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".info.json"))) {
    try {
      const caption = captionFromInfo(JSON.parse(await readFile(join(dir, file), "utf8")));
      if (caption) captions.add(caption);
    } catch {
      // A corrupt sidecar must not hide valid media; extraction still uses audio/OCR.
    }
  }
  return [...captions].join("\n\n");
}

async function writeTranscript(handle: string, code: string, text: string): Promise<void> {
  await writeFile(
    join(transcriptsDir(handle), `${code}.json`),
    JSON.stringify({ shortcode: code, text }, null, 2),
  );
  console.log(`transcribed ${code}`);
}

// venv interpreter with onnx-asr installed. Override with PARAKEET_PYTHON; else
// the conventional ~/asr-venv, else bare python3 (must have onnx-asr importable).
function parakeetPython(): string {
  if (process.env.PARAKEET_PYTHON) return process.env.PARAKEET_PYTHON;
  const venv = join(homedir(), "asr-venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

export async function transcribe(handle: string) {
  await mkdir(transcriptsDir(handle), { recursive: true });

  // Extract 16 kHz mono wav per un-transcribed video (Parakeet's expected input).
  const jobs: { code: string; wav: string; caption: string }[] = [];
  const incomplete: string[] = [];
  for (const d of await readdir(rawDir(handle), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    if (existsSync(join(transcriptsDir(handle), `${code}.json`))) continue; // idempotent
    const dir = join(rawDir(handle), code);
    const files = await readdir(dir);
    const video = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f));
    const images = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    const caption = await captionFromDirectory(dir);
    if (!video) {
      if (images.length) {
        await writeTranscript(handle, code, combineTranscript(caption, ""));
      } else {
        incomplete.push(code);
        console.warn(`pending ${code}: no downloaded media`);
      }
      continue;
    }
    const wav = join(dir, "audio.wav");
    spawnSync("ffmpeg", ["-y", "-i", join(dir, video), "-vn", "-ar", "16000", "-ac", "1", wav], {
      stdio: "ignore",
    });
    // ffmpeg emits nothing for a video with no audio track; skip rather than crash.
    if (existsSync(wav)) jobs.push({ code, wav, caption });
    else {
      // A silent video can still contain a visual call. Persist its caption/empty
      // transcript so the frame stage and extractor process it.
      await writeTranscript(handle, code, combineTranscript(caption, ""));
    }
  }

  if (jobs.length) {
    // One Python invocation loads the model once and transcribes the whole batch.
    const r = spawnSync(parakeetPython(), [SCRIPT], {
      input: JSON.stringify(jobs.map(({ code, wav }) => [code, wav])),
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    // A nonzero exit is a setup/transport failure (missing venv, bad model) — NOT
    // per-file — and must surface loudly, not silently truncate transcripts.
    if (r.status !== 0)
      throw new Error(`parakeet transcribe failed: ${r.stderr || r.error?.message || "unknown"}`);

    const texts: Record<string, string> = JSON.parse(r.stdout);
    for (const { code, caption } of jobs) {
      const text = texts[code];
      if (text == null) {
        incomplete.push(code);
        console.warn(`pending ${code}: no transcript returned`);
        continue;
      }
      await writeTranscript(handle, code, combineTranscript(caption, text));
    }
  }

  if (incomplete.length) {
    throw new Error(
      `transcription incomplete: ${incomplete.length} media item(s) remain: ${incomplete.join(", ")}`,
    );
  }
}
