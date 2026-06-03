// Absolute origin for og:image / canonical / sitemap. og:image MUST be absolute.
// Set VITE_SITE_URL in production (e.g. https://signal-tracker.example), no trailing
// slash. Uses import.meta.env (not process.env) so this module is safe in the client
// bundle too — route head() runs on both server and client.
const RAW =
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? "http://localhost:3000";

export function siteUrl(path = ""): string {
  const base = RAW.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
