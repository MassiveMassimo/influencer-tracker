import { describe, expect, it } from "bun:test";
import {
  parseRating,
  musaffaKey,
  musaffaUrl,
  badgeKindFor,
  purityFraction,
  UNKNOWN_INFO,
} from "./types.ts";

describe("parseRating", () => {
  it("maps known ratings", () => {
    expect(parseRating("COMPLIANT")).toBe("halal");
    expect(parseRating("NON_COMPLIANT")).toBe("not_halal");
    expect(parseRating("NOT_COMPLIANT")).toBe("not_halal");
    expect(parseRating("QUESTIONABLE")).toBe("doubtful");
    expect(parseRating("DOUBTFUL")).toBe("doubtful");
  });
  it("is case-insensitive", () => {
    expect(parseRating("compliant")).toBe("halal");
  });
  it("falls back to unknown", () => {
    expect(parseRating("")).toBe("unknown");
    expect(parseRating(undefined)).toBe("unknown");
    expect(parseRating("WHATEVER")).toBe("unknown");
  });
});

describe("musaffaKey", () => {
  it("uppercases and strips $", () => {
    expect(musaffaKey("aapl")).toBe("AAPL");
    expect(musaffaKey("$nvda")).toBe("NVDA");
  });
  it("converts class-share dash to dot (Yahoo BRK-B -> Musaffa BRK.B)", () => {
    expect(musaffaKey("BRK-B")).toBe("BRK.B");
    expect(musaffaKey("BF-B")).toBe("BF.B");
  });
  it("passes crypto / foreign through unchanged (they won't match Musaffa)", () => {
    expect(musaffaKey("BTC-USD")).toBe("BTC-USD");
    expect(musaffaKey("HEIA.AS")).toBe("HEIA.AS");
  });
});

describe("musaffaUrl", () => {
  it("builds the stock page URL", () => {
    expect(musaffaUrl("AAPL")).toBe("https://musaffa.com/stock/AAPL/");
  });
});

describe("badgeKindFor", () => {
  it("returns a kind only for halal/doubtful", () => {
    expect(badgeKindFor("halal")).toBe("halal");
    expect(badgeKindFor("doubtful")).toBe("doubtful");
    expect(badgeKindFor("not_halal")).toBeNull();
    expect(badgeKindFor("unknown")).toBeNull();
  });
});

describe("purityFraction", () => {
  it("converts 0-100 percent to a 0-1 fraction (gauge percent style x100)", () => {
    expect(purityFraction(95)).toBeCloseTo(0.95);
    expect(purityFraction(0)).toBe(0);
  });
});

describe("UNKNOWN_INFO", () => {
  it("is an unknown record with empty fields", () => {
    expect(UNKNOWN_INFO.status).toBe("unknown");
    expect(UNKNOWN_INFO.musaffaUrl).toBe("");
  });
});
