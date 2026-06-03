import { describe, expect, it } from "bun:test";
import { motifPoints, buildMotifSvg } from "#/og/motif.ts";
import { palette } from "#/og/theme.ts";

describe("motif", () => {
  it("is deterministic per seed", () => {
    expect(motifPoints("alpha", true)).toEqual(motifPoints("alpha", true));
  });
  it("differs across seeds", () => {
    expect(motifPoints("alpha", true)).not.toEqual(motifPoints("beta", true));
  });
  it("normalizes y into [0,1]", () => {
    for (const p of motifPoints("gamma", false)) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
  it("uptrend ends higher than it starts (in chart-space, y inverted later)", () => {
    const pts = motifPoints("delta", true);
    expect(pts[pts.length - 1].y).toBeGreaterThan(pts[0].y);
  });
  it("builds a self-contained svg with gradient + mask", () => {
    const svg = buildMotifSvg({ seed: "x", up: true, palette: palette("light"), width: 1200, height: 630 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("linearGradient");
    expect(svg).toContain("<mask");
    expect(svg).toContain("</svg>");
  });
});
