import type { Format } from "@number-flow/react";

export const PCT_FMT: Format = {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

export function buildHitRateTile({ hitRate, total }: { hitRate: number; total: number }) {
  const winners = Math.round(hitRate * total);

  return {
    label: "Hit rate 3m",
    tone: hitRate - 0.5,
    segments: [{ kind: "num" as const, key: "rate", value: hitRate, format: PCT_FMT }],
    help: {
      body: `Share of calls that beat SPY over the 3 months after the call (excess return > 0). ${winners} of ${total} eligible calls beat SPY. 50% is the coin-flip baseline.`,
      caveat:
        "Scored on one call per ticker (highest conviction); only calls with a full 3 months elapsed count.",
    },
  };
}
