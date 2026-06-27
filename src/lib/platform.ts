// Platform of a call, derived from its shortcode: a numeric shortcode is an X
// tweet id, anything else an IG reel code. Single source for the tell + the
// per-platform profile URL and icon class (previously copy-pasted across
// __root, MobileNav, and the creator header).
export type Platform = "x" | "instagram";

export const platformOf = (shortcode: string): Platform =>
  /^\d+$/.test(shortcode) ? "x" : "instagram";

// Anything other than an explicit "instagram" falls back to X (matches the
// callers' prior defaults when platform is unknown).
export const profileUrl = (platform: Platform | undefined, handle: string): string =>
  platform === "instagram" ? `https://www.instagram.com/${handle}/` : `https://x.com/${handle}`;

export const platformIcon = (platform: Platform | undefined): string =>
  platform === "instagram" ? "icon-[mdi--instagram]" : "icon-[ri--twitter-x-fill]";
