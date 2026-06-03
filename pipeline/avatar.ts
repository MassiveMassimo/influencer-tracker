import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { creatorDir } from "./config";

// Platform-agnostic profile-pic storage. Each scraper (IG/X/TikTok/...) resolves
// its own avatar URL and hands it here; the downstream contract is uniform:
// data/creators/<h>/avatar.txt -> index entry -> WorkspaceRail. The pic is stored
// inline as a base64 data URI because CDN avatar URLs are signed and expire, so
// the bytes must be captured at scrape time. Best-effort: skipped on any failure.
// Returns the data URI it wrote (so callers can also patch index.json), or null.
export async function saveAvatar(handle: string, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    const dataUri = `data:${mime};base64,${b64}`;
    await mkdir(creatorDir(handle), { recursive: true });
    await writeFile(join(creatorDir(handle), "avatar.txt"), dataUri);
    return dataUri;
  } catch { return null; /* avatar is optional */ }
}
