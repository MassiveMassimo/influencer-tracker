// App mark: lucide LineChart glyph on a rounded sea-ink gradient tile (matches
// the MobileNav / WorkspaceRail brand mark). Used to generate the favicon set.
export function iconMarkSvg(size: number): string {
  const r = Math.round(size * 0.22);
  const pad = size * 0.2;
  const inner = size - pad * 2;
  const sw = Math.max(2, size * 0.085);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#173a40"/>
      <stop offset="100%" stop-color="#416166"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#tile)"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 24})" fill="none" stroke="#f3faf5" stroke-width="${(sw * 24) / inner}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 3v16a2 2 0 0 0 2 2h16 M7 16l4-4 3 3 5-6"/>
  </g>
</svg>`;
}
