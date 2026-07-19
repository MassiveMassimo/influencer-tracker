import { LLM_KEY } from "./config";

// Provider-neutral OpenAI-compatible client. calls.ts/classify and vision.ts/readImage
// target it by passing `llm` as the `client`. Base URL + model ids are env-overridable
// so swapping providers is config-only (point LLM_API_KEY/GEMINI_API_KEY at the new key,
// set LLM_BASE_URL + LLM_TEXT_MODEL/LLM_VISION_MODEL). Defaults target Google Gemini via
// its OpenAI-compat endpoint — chosen over Fireworks (2026-07: migration bake-off) for
// both stages: cheaper, and its vision reads real on-screen values instead of hallucinating.
const BASE = (
  process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai"
).replace(/\/$/, "");

// Text classifier. gemini-3.1-flash-lite + the hardened CLASSIFY_SYS matched deepseek-v4-flash
// on scored-buy precision with zero name-vs-symbol slips (migration bake-off, 2026-07-19).
export const TEXT_MODEL = process.env.LLM_TEXT_MODEL ?? "gemini-3.1-flash-lite";
// Vision OCR for ticker/price. Every Gemini tier beat minimax-m3 (which hallucinated tickers);
// 3.1-flash-lite was the best price/accuracy and resolves company name -> symbol (SPY not "SPDR").
export const VISION_MODEL = process.env.LLM_VISION_MODEL ?? "gemini-3.1-flash-lite";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Throw loudly if no key is configured. Call this at the top of each pipeline stage:
// the extract heal-loop swallows per-post errors and breaks without rethrowing, so a
// missing key would otherwise degrade to a silent no-op that reports success.
export function assertLlmKey(): void {
  if (!LLM_KEY) throw new Error("LLM_API_KEY / GEMINI_API_KEY not set (see .env.example)");
}

function retryDelaySec(res: Response, attempt: number): number {
  // Cap the server-provided Retry-After too — a quota-exhaustion response can carry a
  // very long delay, and with high concurrency that would stall every worker in lockstep.
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return Math.min(header, 60);
  return Math.min(2 ** attempt, 30);
}

export async function llm(path: string, init: RequestInit = {}, maxRetries = 6): Promise<Response> {
  assertLlmKey();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${LLM_KEY}`, ...(init.headers ?? {}) },
    });
    if (res.ok) return res;
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      // Jitter breaks the lockstep retry storm when many workers hit the rate wall together.
      const wait = retryDelaySec(res, attempt) + 0.5 + Math.random();
      console.warn(
        `LLM ${res.status} on ${path}; retry ${attempt + 1}/${maxRetries} in ${wait.toFixed(1)}s`,
      );
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`LLM ${path} ${res.status}: ${body}`);
  }
}
