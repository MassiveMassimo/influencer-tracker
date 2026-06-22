import { readFile } from "node:fs/promises";

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
