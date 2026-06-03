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
});
