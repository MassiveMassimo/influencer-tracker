export interface Pt { x: number; y: number }

const n = (v: number) => Number(v.toFixed(2));

// Catmull-Rom spline → cubic béziers, for a gently rounded sparkline. Tension 1
// (uniform). Endpoints duplicate their neighbour so the curve passes through
// every point. 2 points fall back to a straight line; <2 to empty.
export function smoothPath(points: Pt[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${n(points[0].x)},${n(points[0].y)} L${n(points[1].x)},${n(points[1].y)}`;
  }
  let d = `M${n(points[0].x)},${n(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${n(c1x)},${n(c1y)} ${n(c2x)},${n(c2y)} ${n(p2.x)},${n(p2.y)}`;
  }
  return d;
}
