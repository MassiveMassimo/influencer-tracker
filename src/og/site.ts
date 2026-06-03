// Absolute origin for og:image / canonical / sitemap. og:image MUST be absolute.
// Set SITE_URL in production (e.g. https://signal-tracker.example). No trailing slash.
const RAW = process.env.SITE_URL ?? "http://localhost:3000";

export function siteUrl(path = ""): string {
  const base = RAW.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
