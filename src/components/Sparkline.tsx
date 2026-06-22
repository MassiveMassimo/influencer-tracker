import { useId } from "react";
import { smoothPath, type Pt } from "#/lib/svg-smooth.ts";

// Mini stock-path sparkline from a close series: smoothed line + gradient area
// fill fading to transparent at the baseline, dot at the first point. Colored by
// the sign of `excess` (to-date excess in the call table, 1D change in the rail).
export function Sparkline({
  closes,
  excess,
  width = 64,
  height = 20,
}: {
  closes: number[];
  excess: number | null;
  width?: number;
  height?: number;
}) {
  const gid = useId().replace(/:/g, ""); // strip colons — invalid in some SVG url(#…) contexts
  if (closes.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);

  const pts: Pt[] = closes.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const baseline = height; // fill drops to the bottom edge
  const area = `${line} L${pts.at(-1)!.x.toFixed(2)},${baseline} L${pts[0].x.toFixed(2)},${baseline} Z`;

  const color =
    excess == null ? "var(--muted-foreground)" : excess >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={x(0)} cy={y(closes[0])} r={2} fill={color} />
    </svg>
  );
}
