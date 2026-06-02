import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const DATA = join(ROOT, "data", "creators");

export function creatorDir(handle: string) { return join(DATA, handle); }
export function rawDir(handle: string) { return join(creatorDir(handle), "raw"); }
export function transcriptsDir(handle: string) { return join(creatorDir(handle), "transcripts"); }
export function framesDir(handle: string) { return join(creatorDir(handle), "frames"); }
export function pricesDir(handle: string) { return join(creatorDir(handle), "prices"); }

export const GROQ_KEY = process.env.GROQ_API_KEY ?? "";
if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set (see .env.example)");
