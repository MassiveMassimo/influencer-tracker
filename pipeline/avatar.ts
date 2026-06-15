import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AVATARS } from "./config";

// Platform-agnostic profile-pic storage. Each scraper (IG/X/TikTok/...) resolves its
// own avatar URL and hands it here; the downstream contract is uniform: a committed
// image file data/avatars/<h>.<ext> served at /avatars/<h>.<ext>, referenced by path
// from index.json/DB (NOT inlined). The bytes are captured at scrape time because CDN
// avatar URLs are signed and expire. Best-effort: skipped (null) on any failure.
// Returns the public path it wrote, or null.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function saveAvatar(handle: string, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const ext = EXT_BY_MIME[mime] ?? "jpg";
    const bytes = Buffer.from(await res.arrayBuffer());
    await mkdir(AVATARS, { recursive: true });
    // One file per handle: drop any prior-format avatar so score.ts's prefix lookup
    // stays deterministic (e.g. a stale .jpg lingering when we now write .png).
    for (const f of await readdir(AVATARS)) {
      if (f.startsWith(`${handle}.`)) await unlink(join(AVATARS, f));
    }
    await writeFile(join(AVATARS, `${handle}.${ext}`), bytes);
    return `/avatars/${handle}.${ext}`;
  } catch { return null; /* avatar is optional */ }
}
