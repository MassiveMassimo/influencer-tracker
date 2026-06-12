import { test, expect } from "bun:test";
import { mergePrices, detectBasisShift } from "./prices-merge";
import type { OhlcBar } from "./types";

const bar = (date: string, c: number): OhlcBar => ({ date, o: c, h: c, l: c, c });

test("unions by date and sorts ascending", () => {
  const a = [bar("2026-01-03", 3), bar("2026-01-01", 1)];
  const b = [bar("2026-01-02", 2)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 1), bar("2026-01-02", 2), bar("2026-01-03", 3)]);
});

test("existing wins on a date collision (insert-only, matches DB onConflictDoNothing)", () => {
  const a = [bar("2026-01-01", 1)];
  const b = [bar("2026-01-01", 999)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 1)]);
});

test("genuinely-new incoming dates are still appended, sorted ascending", () => {
  const a = [bar("2026-01-02", 1)];
  const b = [bar("2026-01-02", 999), bar("2026-01-03", 3), bar("2026-01-01", 0)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 0), bar("2026-01-02", 1), bar("2026-01-03", 3)]);
});

test("handles empty inputs", () => {
  expect(mergePrices([], [bar("2026-01-01", 1)])).toEqual([bar("2026-01-01", 1)]);
  expect(mergePrices([bar("2026-01-01", 1)], [])).toEqual([bar("2026-01-01", 1)]);
});

test("detects consistent split-factor shift", () => {
  const existing = [{date:"2025-01-01",o:400,h:400,l:400,c:400},{date:"2025-01-02",o:404,h:404,l:404,c:404}];
  const incoming = [{date:"2025-01-01",o:100,h:100,l:100,c:100},{date:"2025-01-02",o:101,h:101,l:101,c:101},{date:"2025-01-03",o:102,h:102,l:102,c:102}];
  expect(detectBasisShift(existing, incoming)).toBeCloseTo(0.25, 3);
});
test("null on same basis / <2 overlap", () => {
  const bars = [{date:"2025-01-01",o:100,h:100,l:100,c:100},{date:"2025-01-02",o:101,h:101,l:101,c:101}];
  expect(detectBasisShift(bars, bars)).toBeNull();
  expect(detectBasisShift([bars[0]], [{...bars[0], c: 9}])).toBeNull();
});
test("null on noisy ratios (inconsistent shift)", () => {
  // ratios 0.25 and 0.30, avg 0.275; |0.30 - 0.275| = 0.025 > 0.02 * 0.275 = 0.0055 → not a clean split
  const existing = [{date:"2025-01-01",o:400,h:400,l:400,c:400},{date:"2025-01-02",o:400,h:400,l:400,c:400}];
  const incoming = [{date:"2025-01-01",o:100,h:100,l:100,c:100},{date:"2025-01-02",o:120,h:120,l:120,c:120}];
  expect(detectBasisShift(existing, incoming)).toBeNull();
});
