import { test, expect } from "bun:test";
import { makeDb } from "./client";
import { callOverrides, creators } from "./schema";
import { loadOverrides } from "./overrides";

const url = process.env.DATABASE_URL_INGEST_TEST;
const t = url ? test : test.skip;

t("loadOverrides returns the rows for a handle, mapped to the Override shape", async () => {
  const db = makeDb(url!);
  // Clean slate for the override and its FK parent.
  await db.delete(callOverrides);
  await db
    .insert(creators)
    .values({
      handle: "h",
      name: "n",
      ord: 0,
      generatedAt: "2026-06-13",
      spyAnchor: "2026-01-01",
      scorecard: {},
      caveats: [],
      indexStats: {},
    })
    .onConflictDoNothing();
  await db.insert(callOverrides).values({
    handle: "h",
    shortcode: "AAA",
    targetTicker: "NVDA",
    ticker: "AMD",
    isExplicitBuy: null,
    direction: null,
    reason: "wrong ticker",
    createdAt: "2026-06-13",
  });
  const got = await loadOverrides(db, "h");
  expect(got).toEqual([
    {
      handle: "h",
      shortcode: "AAA",
      targetTicker: "NVDA",
      ticker: "AMD",
      isExplicitBuy: null,
      direction: null,
      reason: "wrong ticker",
    },
  ]);
});
