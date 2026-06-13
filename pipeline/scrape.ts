// Browser-driven scrape of a creator's reels in the last `months` months.
// Stealth: real Chromium, human-like delays, harvest shortcodes+dates from
// intercepted GraphQL, then download each video with yt-dlp.
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { mkdir, writeFile, readFile } from "node:fs/promises";
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

// Netscape cookie jar -> Playwright cookies, so a seeded session (cookies.txt
// rsynced from another machine) logs in headlessly without a manual browser login.
// Handles the `#HttpOnly_` line prefix (curl/yt-dlp dialect); other `#` lines are comments.
function fromNetscape(text: string): any[] {
  const out: any[] = [];
  for (let line of text.split("\n")) {
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) { httpOnly = true; line = line.slice(10); }
    else if (line.startsWith("#") || !line.trim()) continue;
    const p = line.split("\t");
    if (p.length < 7) continue;
    const [domain, , path, secure, expiry, name, value] = p;
    out.push({
      name, value, domain, path: path || "/",
      expires: Number(expiry) > 0 ? Number(expiry) : -1,
      httpOnly, secure: secure === "TRUE",
    });
  }
  return out;
}

// True if the context already carries a logged-in IG session (ds_user_id cookie).
async function hasSession(ctx: any): Promise<boolean> {
  const cookies = await ctx.cookies("https://www.instagram.com");
  // Match waitForLogin: a cleared-but-not-purged cookie has the key with an empty
  // value and is not a live session.
  return cookies.some((c: any) => c.name === "ds_user_id" && c.value);
}

// Seed a prior session from cookies.txt if present; returns true if cookies were loaded.
async function seedCookies(ctx: any, handle: string): Promise<boolean> {
  const jar = cookiesPath(handle);
  if (!existsSync(jar)) return false;
  try {
    const cookies = fromNetscape(await readFile(jar, "utf8"));
    if (!cookies.length) return false;
    await ctx.addCookies(cookies);
    return true;
  } catch (e) {
    console.warn("cookie seed failed — falling back to manual login", e);
    return false;
  }
}

// Residential egress for IG. Set IG_PROXY=socks5://127.0.0.1:1081 on the VM (iProyal
// ISP relay); unset on the Mac so it scrapes direct. Playwright SOCKS5 must be no-auth.
const IG_PROXY = process.env.IG_PROXY;

export async function scrape(handle: string, months = 12, userDataDir = ".chrome-profile") {
  const cutoff = Date.now() - months * 30 * 86400_000;
  const ctx = await (chromium as any).launchPersistentContext(userDataDir, {
    headless: false,
    ...(IG_PROXY ? { proxy: { server: IG_PROXY } } : {}),
  });
  const page = await ctx.newPage();

  // Prove residential egress before scraping. A silent proxy failure (relay down,
  // IG_PROXY typo) would scrape from the datacenter IP and get the account locked —
  // the exact failure this guards against. Abort loudly instead, and log the IP so a
  // run visibly confirms it's residential.
  if (IG_PROXY) {
    let egress = "";
    try {
      await page.goto("https://api.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: 15_000 });
      egress = JSON.parse(await page.evaluate(() => document.body.innerText))?.ip ?? "";
    } catch { /* egress stays empty -> abort below */ }
    if (!egress) {
      await ctx.close();
      throw new Error(`IG_PROXY=${IG_PROXY} egress check failed (relay down/unreachable) — aborting to avoid scraping from the datacenter IP`);
    }
    console.log(`>>> IG proxy egress IP: ${egress}`);
  }

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

  // Prefer the persistent profile's own session (a real browser login performed once,
  // e.g. seeded over VNC on the VM) — IG only trusts the heavier GraphQL harvest from a
  // genuinely-logged-in session. Only seed cookies.txt when the profile has none; seeding
  // stale cookies would clobber a good profile login. scrape() rewrites cookies.txt from
  // the live (trusted) session at teardown (below), so yt-dlp downloads stay valid.
  const loggedIn = (await hasSession(ctx)) || (await seedCookies(ctx, handle));

  // Gate on login before scrolling. A logged-in profile/seeded session is detected fast;
  // a fresh profile with no session waits for a manual browser login.
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  if (!(await waitForLogin(ctx, loggedIn ? 15_000 : 6 * 60_000))) {
    if (loggedIn) { await ctx.close(); throw new Error("IG session rejected (expired/challenged) — re-login the .chrome-profile (VNC) or refresh cookies.txt"); }
    console.log("\n>>> Log into Instagram in the open browser window. Waiting for session...");
    if (!(await waitForLogin(ctx))) {
      await ctx.close();
      throw new Error("login not detected within timeout — re-run after logging in");
    }
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
  const proxyArgs = IG_PROXY ? ["--proxy", IG_PROXY] : [];
  const r = spawnSync("yt-dlp", [
    ...cookieArgs,
    ...proxyArgs,
    "-o", join(out, "reel.%(ext)s"),
    "--write-info-json", url,
  ], { stdio: "inherit" });
  return r.status === 0;
}
