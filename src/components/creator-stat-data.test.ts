import { expect, test } from "bun:test";
import { buildHitRateTile, PCT_FMT } from "./creator-stat-data";

test("buildHitRateTile keeps the sample detail in help copy, not the headline", () => {
  const tile = buildHitRateTile({ hitRate: 0.464, total: 265 });

  expect(tile.segments).toEqual([{ kind: "num", key: "rate", value: 0.464, format: PCT_FMT }]);
  expect(tile.help.body).toContain("123 of 265 eligible calls");
});
