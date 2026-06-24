import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface FrameHint {
  ticker: string | null;
  price: number | null;
}

const PROMPT =
  "This is a frame from a stock-picker's video or a chart image. Read any on-screen " +
  "stock ticker symbol and any displayed price. Reply as compact JSON: " +
  '{"ticker": string|null, "price": number|null}. No prose.';

// Parse the model's JSON reply, tolerating code fences and garbage.
export function parseHint(content: string): FrameHint {
  try {
    return JSON.parse(content.replace(/```json|```/g, "")) as FrameHint;
  } catch {
    return { ticker: null, price: null };
  }
}

// OpenAI-compatible POST fn (fireworks).
type ChatClient = (path: string, init?: RequestInit) => Promise<Response>;

// Run the vision model on a single image, returning the ticker/price hint.
export async function readImage(
  vision: string,
  imgPath: string,
  client: ChatClient,
): Promise<FrameHint> {
  const b64 = (await readFile(imgPath)).toString("base64");
  const body = {
    model: vision,
    messages: [{ role: "user", content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
    ] }],
    temperature: 0,
  };
  const r = await (await client("/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).json() as { choices: { message: { content: string } }[] };
  return parseHint(r.choices[0].message.content);
}

// Disk-cached wrapper. Vision OCR is deterministic per image (temp 0) and the source
// images are immutable pipeline intermediates, so the hint is cached in a sidecar
// `<img>.hint.json`. A re-extract (e.g. a CLASSIFY_SYS prompt change) then reuses the
// OCR instead of re-billing the vision model — vision is ~⅔ of extract cost, so a
// text-only re-classify shouldn't pay for it twice. The cache lives beside the image in
// the gitignored raw/frames dirs; deleting it just forces a re-OCR. extract filters image
// files by extension, so the `.hint.json` sidecar is never itself treated as an image.
export async function readImageCached(
  vision: string,
  imgPath: string,
  client: ChatClient,
): Promise<FrameHint> {
  const cachePath = `${imgPath}.hint.json`;
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as FrameHint;
    } catch {
      // Corrupt cache — fall through and re-OCR.
    }
  }
  const hint = await readImage(vision, imgPath, client);
  await writeFile(cachePath, JSON.stringify(hint));
  return hint;
}
