import { GROQ_KEY } from "./config";

const BASE = "https://api.groq.com/openai/v1";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Seconds to wait before retry: prefer Retry-After header, else the "try again
// in Ns" hint in the body, else exponential backoff.
function retryDelaySec(res: Response, body: string, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return header;
  const m = body.match(/try again in ([\d.]+)s/i);
  if (m) return Number(m[1]);
  return Math.min(2 ** attempt, 30);
}

async function groq(path: string, init: RequestInit = {}, maxRetries = 6) {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set (see .env.example)");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${GROQ_KEY}`, ...(init.headers ?? {}) },
    });
    if (res.ok) return res;
    const body = await res.text();
    // Free-tier TPM limits (429) and transient 503s are recoverable; back off.
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const wait = retryDelaySec(res, body, attempt) + 0.5;
      console.warn(`Groq ${res.status} on ${path}; retry ${attempt + 1}/${maxRetries} in ${wait.toFixed(1)}s`);
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`Groq ${path} ${res.status}: ${body}`);
  }
}

/** Pick the current STT, vision, and text model ids from /models (avoids stale hardcoding). */
export async function discoverModels() {
  const { data } = await (await groq("/models")).json() as { data: { id: string }[] };
  const ids = data.map(m => m.id);
  const pick = (subs: string[]) => ids.find(id => subs.every(s => id.includes(s)));
  const stt = ids.find(id => id.includes("whisper")) ?? "whisper-large-v3";
  const vision = pick(["llama", "vision"]) ?? pick(["scout"]) ?? pick(["maverick"]) ?? "";
  const text = pick(["llama", "70b"]) ?? pick(["llama-3.3"]) ?? pick(["versatile"]) ?? "";
  if (!vision || !text) throw new Error(`Could not resolve Groq models from: ${ids.join(", ")}`);
  return { stt, vision, text };
}

export { groq };
