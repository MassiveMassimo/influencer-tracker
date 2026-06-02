import { z } from "zod";

const ReturnTriple = z.object({
  stock: z.number().nullable(),
  spy: z.number().nullable(),
  excess: z.number().nullable(),
});

const CallSchema = z.object({
  shortcode: z.string(),
  postDate: z.string(),
  ticker: z.string(),
  company: z.string(),
  isFirstCall: z.boolean(),
  conviction: z.number().min(0).max(1),
  quote: z.string(),
  onScreenPrice: z.number().nullable().optional(),
  returns: z.object({
    "1w": ReturnTriple, "1m": ReturnTriple, "3m": ReturnTriple, "toDate": ReturnTriple,
  }),
});

export const DatasetSchema = z.object({
  creator: z.object({ handle: z.string(), name: z.string() }),
  generatedAt: z.string(),
  spyAnchor: z.string(),
  calls: z.array(CallSchema),
  tickers: z.record(z.string(), z.object({
    ohlc: z.array(z.object({
      date: z.string(), o: z.number(), h: z.number(), l: z.number(), c: z.number(),
    })),
  })),
  scorecard: z.object({
    totalCalls: z.number(), uniqueTickers: z.number(),
    hitRate: z.object({ "1m": z.number(), "3m": z.number() }),
    avgExcess: z.object({ "1w": z.number(), "1m": z.number(), "3m": z.number(), "toDate": z.number() }),
    callsPerWeek: z.number(), best: z.array(CallSchema), worst: z.array(CallSchema),
  }),
  caveats: z.array(z.string()),
});
