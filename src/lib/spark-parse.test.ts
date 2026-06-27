import { test, expect } from "bun:test";
import { parseSparkResponse, sampleCloses } from "./spark-parse";

test("sampleCloses keeps first+last and caps length", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const out = sampleCloses(arr, 10);
  expect(out.length).toBe(10);
  expect(out[0]).toBe(0);
  expect(out.at(-1)).toBe(99);
});

test("parseSparkResponse: good symbol uses prevClose for changePct", () => {
  const json = {
    spark: {
      result: [
        {
          symbol: "AAPL",
          response: [
            {
              meta: { chartPreviousClose: 100 },
              indicators: { quote: [{ close: [101, 102, null, 110] }] },
            },
          ],
        },
      ],
    },
  };
  const out = parseSparkResponse(json);
  expect(out.AAPL.closes).toEqual([101, 102, 110]); // null dropped
  expect(out.AAPL.changePct).toBeCloseTo(0.1, 5); // (110-100)/100
});

test("parseSparkResponse: symbol with <2 valid closes is omitted", () => {
  const json = {
    spark: {
      result: [
        { symbol: "THIN", response: [{ meta: {}, indicators: { quote: [{ close: [null, 5] }] } }] },
      ],
    },
  };
  expect(parseSparkResponse(json).THIN).toBeUndefined();
});

test("parseSparkResponse: malformed input → empty object, no throw", () => {
  expect(parseSparkResponse(null)).toEqual({});
  expect(parseSparkResponse({ spark: {} })).toEqual({});
});
