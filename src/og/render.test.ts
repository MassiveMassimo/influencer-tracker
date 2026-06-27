import { describe, expect, it } from "bun:test";
import { renderOgPng, OG_WIDTH, OG_HEIGHT } from "#/og/render.tsx";

function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("renderOgPng", () => {
  it("renders a creator card to a 1200x630 png", async () => {
    const buf = await renderOgPng({
      kind: "creator",
      theme: "light",
      name: "Test Creator",
      handle: "test",
      excess3m: 0.124,
      totalCalls: 42,
    });
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });

  it("renders the home card (dark)", async () => {
    const buf = await renderOgPng({ kind: "home", theme: "dark" });
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });

  it("renders the changelog card (dark)", async () => {
    const buf = await renderOgPng({ kind: "changelog", theme: "dark" });
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });

  it("renders a ticker card with null excess", async () => {
    const buf = await renderOgPng({
      kind: "ticker",
      theme: "light",
      symbol: "NVDA",
      name: "Test Creator",
      handle: "test",
      excess3m: null,
    });
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });

  it("renders a ticker card with a line-graph background to a PNG", async () => {
    const png = await renderOgPng({
      kind: "ticker",
      theme: "dark",
      symbol: "PLTR",
      company: "Palantir",
      name: "Test Creator",
      handle: "test",
      excess3m: 0.12,
      closes: [10, 11, 9, 12, 14, 13, 15, 16, 14, 17],
    });
    // PNG magic bytes: 89 50 4E 47
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("renders a ticker card with no closes (falls back to seeded bg)", async () => {
    const png = await renderOgPng({
      kind: "ticker",
      theme: "dark",
      symbol: "AAPL",
      name: "Test Creator",
      handle: "test",
      excess3m: null,
    });
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("renders a cross-creator ticker-all card with a line-graph background", async () => {
    const buf = await renderOgPng({
      kind: "ticker-all",
      theme: "dark",
      symbol: "NVDA",
      company: "NVIDIA",
      creatorCount: 4,
      callCount: 11,
      avgExcess: 0.083,
      closes: [10, 11, 9, 12, 14, 13, 15, 16, 14, 17],
    });
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });

  it("renders a minimal ticker-all card (no closes, null excess)", async () => {
    const buf = await renderOgPng({
      kind: "ticker-all",
      theme: "dark",
      symbol: "AMD",
      creatorCount: 0,
      callCount: 0,
      avgExcess: null,
    });
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });
});
