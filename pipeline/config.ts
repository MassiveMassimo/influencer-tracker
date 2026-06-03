import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const DATA = join(ROOT, "data", "creators");

export function creatorDir(handle: string) { return join(DATA, handle); }
export function rawDir(handle: string) { return join(creatorDir(handle), "raw"); }
export function transcriptsDir(handle: string) { return join(creatorDir(handle), "transcripts"); }
export function framesDir(handle: string) { return join(creatorDir(handle), "frames"); }
export function pricesDir(handle: string) { return join(creatorDir(handle), "prices"); }

export const GROQ_KEY = process.env.GROQ_API_KEY ?? "";
export const RETTIWT_KEY = process.env.RETTIWT_API_KEY ?? "";
export const FIREWORKS_KEY = process.env.FIREWORKS_API_KEY ?? "";
