import { describe, expect, it } from "bun:test";
import { isDaytime, ogTheme, NYC } from "#/og/solar.ts";

describe("solar", () => {
  // NYC summer solstice: ~16:00 UTC is local noon (EDT) → day; 05:00 UTC ~1am → night.
  it("is day at local noon", () => {
    expect(isDaytime(new Date("2026-06-21T16:00:00Z"), NYC.lat, NYC.lng)).toBe(true);
  });
  it("is night after local midnight", () => {
    expect(isDaytime(new Date("2026-06-21T05:00:00Z"), NYC.lat, NYC.lng)).toBe(false);
  });
  it("is night in winter pre-dawn", () => {
    expect(isDaytime(new Date("2026-12-21T10:00:00Z"), NYC.lat, NYC.lng)).toBe(false);
  });
  it("ogTheme maps day→light, night→dark", () => {
    expect(ogTheme(new Date("2026-06-21T16:00:00Z"))).toBe("light");
    expect(ogTheme(new Date("2026-06-21T05:00:00Z"))).toBe("dark");
  });
});
