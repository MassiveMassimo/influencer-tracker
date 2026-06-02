// Browser-driven scrape of a creator's reels in the last `months` months.
// Stealth: real Chromium, human-like delays, harvest shortcodes+dates from
// intercepted GraphQL, then download each video with yt-dlp.
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rawDir } from "./config";

(chromium as any).use(stealth());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

export async function scrape(handle: string, months = 12, userDataDir = ".chrome-profile") {
  const cutoff = Date.now() - months * 30 * 86400_000;
  const ctx = await (chromium as any).launchPersistentContext(userDataDir, { headless: false });
  const page = await ctx.newPage();

  const seen = new Map<string, number>(); // shortcode -> taken_at (epoch ms)
  page.on("response", async (res: any) => {
    const url = res.url();
    if (!url.includes("/graphql") && !url.includes("/api/v1/")) return;
    try {
      const json: any = await res.json();
      for (const node of findReels(json)) {
        if (node.code) seen.set(node.code, (node.taken_at ?? 0) * 1000);
      }
    } catch { /* non-JSON response */ }
  });

  await page.goto(`https://www.instagram.com/${handle}/reels/`, { waitUntil: "domcontentloaded" });
  // Human-like scroll until we pass the cutoff date or stop finding new reels.
  let stagnant = 0;
  while (stagnant < 4) {
    const before = seen.size;
    await page.mouse.wheel(0, 1200 + jitter(0, 800));
    await sleep(jitter(1500, 3500));
    const oldest = Math.min(...[...seen.values()].filter(Boolean), Date.now());
    if (oldest < cutoff) break;
    stagnant = seen.size === before ? stagnant + 1 : 0;
  }
  await ctx.close();

  const recent = [...seen.entries()].filter(([, t]) => !t || t >= cutoff).map(([code]) => code);
  await mkdir(rawDir(handle), { recursive: true });
  await writeFile(join(rawDir(handle), "shortcodes.json"), JSON.stringify(recent, null, 2));
  return recent;
}

// Recursively find objects that look like reel media nodes.
function* findReels(obj: any): Generator<any> {
  if (!obj || typeof obj !== "object") return;
  if (typeof obj.code === "string" && ("taken_at" in obj || "media_type" in obj)) yield obj;
  for (const v of Object.values(obj)) yield* findReels(v);
}

export function downloadReel(handle: string, shortcode: string): boolean {
  const out = join(rawDir(handle), shortcode);
  const url = `https://www.instagram.com/reel/${shortcode}/`;
  const r = spawnSync("yt-dlp", [
    "--cookies-from-browser", "chrome",
    "-o", join(out, "reel.%(ext)s"),
    "--write-info-json", url,
  ], { stdio: "inherit" });
  return r.status === 0;
}
