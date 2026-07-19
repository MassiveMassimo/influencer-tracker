import { LLM_KEY } from "./config";

// Provider-neutral OpenAI-compatible client. calls.ts/classify and vision.ts/readImage
// target it by passing `llm` as the `client`. Base URL + model ids are env-overridable
// so swapping providers is config-only (point LLM_API_KEY/GEMINI_API_KEY at the new key,
// set LLM_BASE_URL + LLM_TEXT_MODEL/LLM_VISION_MODEL). Defaults target Google Gemini via
// its OpenAI-compat endpoint — chosen over Fireworks (2026-07: migration bake-off) for
// both stages: cheaper, and its vision reads real on-screen values instead of hallucinating.
const BASE = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";

// Text classifier. gemini-3.1-flash-lite + the hardened CLASSIFY_SYS matched deepseek-v4-flash
// on scored-buy precision with zero name-vs-symbol slips (migration bake-off, 2026-07-19).
export const TEXT_MODEL = process.env.LLM_TEXT_MODEL ?? "gemini-3.1-flash-lite";
// Vision OCR for ticker/price. Every Gemini tier beat minimax-m3 (which hallucinated tickers);
// 3.1-flash-lite was the best price/accuracy and resolves company name -> symbol (SPY not "SPDR").
export const VISION_MODEL = process.env.LLM_VISION_MODEL ?? "gemini-3.1-flash-lite";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelaySec(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return header;
  return Math.min(2 ** attempt, 30);
}

export async function llm(path: string, init: RequestInit = {}, maxRetries = 6): Promise<Response> {
  if (!LLM_KEY) throw new Error("GEMINI_API_KEY not set (see .env.example)");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${LLM_KEY}`, ...(init.headers ?? {}) },
    });
    if (res.ok) return res;
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const wait = retryDelaySec(res, attempt) + 0.5;
      console.warn(
        `LLM ${res.status} on ${path}; retry ${attempt + 1}/${maxRetries} in ${wait.toFixed(1)}s`,
      );
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`LLM ${path} ${res.status}: ${body}`);
  }
}
