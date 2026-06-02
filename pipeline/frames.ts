import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, framesDir } from "./config";
import { groq, discoverModels } from "./groq";

const PROMPT =
  "This is a frame from a stock-picker's video. Read any on-screen stock ticker " +
  "symbol and any displayed price. Reply as compact JSON: " +
  '{"ticker": string|null, "price": number|null}. No prose.';

interface FrameHint {
  ticker: string | null;
  price: number | null;
}

async function readFrame(vision: string, imgPath: string): Promise<FrameHint> {
  const b64 = (await readFile(imgPath)).toString("base64");
  const body = {
    model: vision,
    messages: [{ role: "user", content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
    ] }],
    temperature: 0,
  };
  const r = await (await groq("/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).json() as { choices: { message: { content: string } }[] };
  try { return JSON.parse(r.choices[0].message.content.replace(/```json|```/g, "")) as FrameHint; }
  catch { return { ticker: null, price: null }; }
}

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
      if (existsSync(img)) hints.push(await readFrame(vision, img));
    }
    await writeFile(out, JSON.stringify({ shortcode: code, hints }, null, 2));
    console.log(`frames ${code}:`, hints);
  }
}
