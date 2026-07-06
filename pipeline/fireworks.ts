import { FIREWORKS_KEY } from "./config";

// Fireworks is OpenAI-compatible; calls.ts/classify target it by passing this as
// the `client`. Used for all text + vision classification (deepseek-v4-flash text,
// minimax-m3 vision) across both the IG and high-volume X paths.
const BASE = "https://api.fireworks.ai/inference/v1";

// Text classifier. Bake-off on real TheProfInvestor tweets: deepseek-v4-flash
// scored 11/11 vs gpt-oss-120b's 8/11 (the latter under-flagged implicit calls
// like "going higher"/"your cue" as non-buys), runs ~3s, and is cheapest on output.
export const FIREWORKS_MODEL = "accounts/fireworks/models/deepseek-v4-flash";
// Vision OCR for ticker/price. Fireworks undeployed kimi-k2p5 from serverless
// (404 NOT_FOUND), which hard-stalled IG ingest 2026-07-04..06. Re-bakeoff (2026-07-06,
// 4 live serverless VLMs × 9 real frames): minimax-m3 is the only model that reliably
// honors the "compact JSON, no prose" contract parseHint expects — kimi-k2p6/kimi-k2p7-code/
// qwen3p7-plus leak chain-of-thought, so parseHint fails and the hint silently goes null.
// minimax-m3 read BTC-USD/AAOI exactly, is cheapest ($0.30/$1.20 per 1M in/out) and fast
// (~2s). The OCR-specialist models (paddleocr, rolm, firesearch) list as serverless but 404.
export const FIREWORKS_VISION_MODEL = "accounts/fireworks/models/minimax-m3";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelaySec(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return header;
  return Math.min(2 ** attempt, 30);
}

export async function fireworks(
  path: string,
  init: RequestInit = {},
  maxRetries = 6,
): Promise<Response> {
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
      console.warn(
        `Fireworks ${res.status} on ${path}; retry ${attempt + 1}/${maxRetries} in ${wait.toFixed(1)}s`,
      );
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`Fireworks ${path} ${res.status}: ${body}`);
  }
}
