import { FIREWORKS_KEY } from "./config";

// Fireworks is OpenAI-compatible; same call shape as groq() so calls.ts/classify
// can target it by passing this as the `client`. Used for the high-volume X
// tweet classification (gpt-oss-120b) where Groq's free tier is too rate-limited.
const BASE = "https://api.fireworks.ai/inference/v1";

// Default text model for classification.
export const FIREWORKS_MODEL = "accounts/fireworks/models/gpt-oss-120b";

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
