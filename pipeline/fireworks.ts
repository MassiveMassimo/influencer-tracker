import { FIREWORKS_KEY } from "./config";

// Fireworks is OpenAI-compatible; calls.ts/classify target it by passing this as
// the `client`. Used for all text + vision classification (deepseek-v4-flash text,
// kimi-k2p5 vision) across both the IG and high-volume X paths.
const BASE = "https://api.fireworks.ai/inference/v1";

// Text classifier. Bake-off on real TheProfInvestor tweets: deepseek-v4-flash
// scored 11/11 vs gpt-oss-120b's 8/11 (the latter under-flagged implicit calls
// like "going higher"/"your cue" as non-buys), runs ~3s, and is cheapest on output.
export const FIREWORKS_MODEL = "accounts/fireworks/models/deepseek-v4-flash";
// Vision OCR for ticker/price. kimi-k2p5 matched qwen3p6-plus accuracy (3/3) but
// at ~7s/image vs ~57s (qwen's latency was timing out the extract). The cheaper
// small VLMs (qwen3-vl-8b, gemma-4, llama-vision) are on-demand-GPU only — 404 on
// serverless — so kimi-k2p5 is the best serverless balance.
export const FIREWORKS_VISION_MODEL = "accounts/fireworks/models/kimi-k2p5";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelaySec(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return header;
  return Math.min(2 ** attempt, 30);
}

export async function fireworks(path: string, init: RequestInit = {}, maxRetries = 6): Promise<Response> {
  if (!FIREWORKS_KEY) throw new Error("FIREWORKS_API_KEY not set (see .env.example)");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${FIREWORKS_KEY}`, ...(init.headers ?? {}) },
    });
    if (res.ok) return res;
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const wait = retryDelaySec(res, attempt) + 0.5;
      console.warn(`Fireworks ${res.status} on ${path}; retry ${attempt + 1}/${maxRetries} in ${wait.toFixed(1)}s`);
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`Fireworks ${path} ${res.status}: ${body}`);
  }
}
