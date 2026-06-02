import { GROQ_KEY } from "./config";

const BASE = "https://api.groq.com/openai/v1";

async function groq(path: string, init: RequestInit = {}) {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set (see .env.example)");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${GROQ_KEY}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Groq ${path} ${res.status}: ${await res.text()}`);
  return res;
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
