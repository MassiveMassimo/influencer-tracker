// Short, dependency-free content hash for cache-busting OG image URLs. Isomorphic
// (no node:crypto) so it is safe to call from route head() in the client bundle.
// A new rev means a new og:image URL, which forces crawlers to refetch the card.
export function ogRev(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
