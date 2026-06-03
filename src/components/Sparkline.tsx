// Mini stock-path sparkline from a baked close series, dot at the first point.
// Colored by the call's to-date excess sign.
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
  if (closes.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = closes.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color =
    excess == null ? "var(--muted-foreground)" : excess >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={x(0)} cy={y(closes[0])} r={2} fill={color} />
    </svg>
  );
}
