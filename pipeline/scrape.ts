// Browser-driven scrape of a creator's reels in the last `months` months.
// Stealth: real Chromium, human-like delays, harvest shortcodes+dates from
// intercepted GraphQL, then download each video with yt-dlp.
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rawDir, creatorDir } from "./config";
import { saveAvatar } from "./avatar";

(chromium as any).use(stealth());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

// yt-dlp reads this Netscape cookie jar so downloads reuse the harvest login.
function cookiesPath(handle: string) { return join(creatorDir(handle), "cookies.txt"); }

// Block until the IG session cookie appears, so a fresh profile gets a manual
// login instead of silently hitting the logged-out wall and harvesting nothing.
async function waitForLogin(ctx: any, timeoutMs = 6 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await ctx.cookies("https://www.instagram.com");
    if (cookies.some((c: any) => c.name === "ds_user_id" && c.value)) return true;
    await sleep(2000);
  }
  return false;
}

// Playwright cookies -> Netscape format (domain, includeSub, path, secure, expiry, name, value).
function toNetscape(cookies: any[]): string {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    const domain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
    const expiry = Math.floor(c.expires && c.expires > 0 ? c.expires : Date.now() / 1000 + 31536000);
    lines.push([domain, "TRUE", c.path || "/", c.secure ? "TRUE" : "FALSE", expiry, c.name, c.value].join("\t"));
  }
  return lines.join("\n") + "\n";
}

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

  // Gate on login before scrolling. Fresh profile -> user logs in manually.
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  console.log("\n>>> Log into Instagram in the open browser window. Waiting for session...");
  if (!(await waitForLogin(ctx))) {
    await ctx.close();
    throw new Error("login not detected within timeout — re-run after logging in");
  }
  console.log(">>> Login detected. Harvesting reels...");

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

  // Capture the profile pic while the logged-in page context is still alive.
  await saveAvatar(handle, await resolveAvatarUrl(page, handle));

  // Persist session cookies for yt-dlp before tearing down the context.
  await mkdir(creatorDir(handle), { recursive: true });
  await writeFile(cookiesPath(handle), toNetscape(await ctx.cookies()));
  await ctx.close();

  const recent = [...seen.entries()].filter(([, t]) => !t || t >= cutoff).map(([code]) => code);
  await mkdir(rawDir(handle), { recursive: true });
  await writeFile(join(rawDir(handle), "shortcodes.json"), JSON.stringify(recent, null, 2));
  return recent;
}

// Resolve the IG profile pic URL via web_profile_info. Runs in the page context
// (same-origin, so session cookies ride along) with the public web app id header.
async function resolveAvatarUrl(page: any, handle: string): Promise<string | null> {
  try {
    return await page.evaluate(async (h: string) => {
      const r = await fetch(`/api/v1/users/web_profile_info/?username=${h}`, {
        headers: { "x-ig-app-id": "936619743392459" },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.data?.user?.profile_pic_url_hd ?? j?.data?.user?.profile_pic_url ?? null;
    }, handle);
  } catch { return null; }
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
  const jar = cookiesPath(handle);
  const cookieArgs = existsSync(jar) ? ["--cookies", jar] : ["--cookies-from-browser", "chrome"];
  const r = spawnSync("yt-dlp", [
    ...cookieArgs,
    "-o", join(out, "reel.%(ext)s"),
    "--write-info-json", url,
  ], { stdio: "inherit" });
  return r.status === 0;
}
