// Absolute origin for og:image / canonical / sitemap. og:image MUST be absolute.
// Set VITE_SITE_URL in production (e.g. https://signal-tracker.example), no trailing
// slash. Preview functions use Vercel's deployment URL; client-side route head()
// updates use the current browser origin.
const CONFIGURED_ORIGIN = import.meta.env.VITE_SITE_URL as string | undefined;

function currentOrigin(): string {
  if (CONFIGURED_ORIGIN) return CONFIGURED_ORIGIN;
  if (typeof window !== "undefined") return window.location.origin;
  if (typeof process !== "undefined" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export function siteUrl(path = ""): string {
  const base = currentOrigin().replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
