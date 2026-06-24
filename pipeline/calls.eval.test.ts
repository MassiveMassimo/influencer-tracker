import { describe, expect, test } from "bun:test";
import { classify } from "./calls";
import { fireworks, FIREWORKS_MODEL } from "./fireworks";

// Labeled LLM eval pinning the recap/track-record discriminator in CLASSIFY_SYS
// (see calls.ts bake-off note). It hits Fireworks ($ + network), so it is gated on
// FIREWORKS_API_KEY && RUN_LLM_EVAL and skipped by a plain `bun test`. Run it after
// any CLASSIFY_SYS edit or model swap:
//   RUN_LLM_EVAL=1 bun test pipeline/calls.eval.test.ts
//
// Assertions are must-include / must-exclude on the SCORED set (isExplicitBuy &&
// bullish) rather than exact-set equality — a borderline neutral mention elsewhere is
// not what this guards. The failure it locks out: retrospective brags ("first to share
// $X at $Y", "my best buy was $X at $Y") scored as live buys, and forward picks dropped.
//
// Real-tweet fixtures are verbatim thelonginvest posts (raw/ is gitignored, so the text
// is inlined to keep the test self-contained); SYNTHETIC cases cover phrasings review
// flagged as untested (precedence, endorsed relay, watchlist).
type Case = { name: string; text: string; include?: string[]; exclude?: string[] };

const CASES: Case[] = [
  {
    name: "pure recap + forward 'what's next' list (real: 2068305592083423341)",
    text: `First to share $PLTR at $7\n\nFirst to share $HIMS at $10\n\nFirst to share $OSCR at $11\n\nFirst to share $ADUR at $3.80\n\nFirst to be bullish on $BABA at $70\n\nFirst to be bullish on $AMD at $72\n\nFirst to be bullish on Silver at $24\n\nFirst to be bullish on $UNH at $250\n\nFirst to be bullish on $ASTS at $3\n\nFirst to share $ZETA at $15\n\nThe origin of the retail investor is here\n\nIf it's on our radar your position is going to gain.\n\nSo what's next?\n\n$ZVRA\n$NVO\n$ETH\n$GRRR\n$DCTH`,
    include: ["ZVRA", "NVO", "ETH", "GRRR", "DCTH"],
    exclude: ["PLTR", "HIMS", "OSCR", "ADUR", "BABA", "AMD", "UNH", "ASTS", "ZETA"],
  },
  {
    name: "pure recap 'my X buy was $T at $Y' + 'my next buy is' (real: 2065401024701931582)",
    text: `My safest buy was $UNH at $241\nMy most grateful buy was $ADUR at $3.85\nMy smartest buy was Silver at $24\nMy most comfortable buy was $HIMS at $11\nMy easiest buy was $AMD at $98\nMy most rewarding buys were $AMZN & $GOOG on their 200WMA\nMy most disappointing buy was $PYPL\nMy most educational buy was $NIO in 2020\nMy next buy is $DCTH/$GRRR/$ZVRA`,
    include: ["DCTH", "GRRR", "ZVRA"],
    exclude: ["UNH", "ADUR", "HIMS", "AMD", "AMZN", "GOOG", "PYPL", "NIO"],
  },
  {
    name: "current target +50% to Wave-3 (real: 2053857124342493628)",
    text: `If I told you that $NBIS has another +50% to gain before hitting our Wave 3 target you would not believe me….`,
    include: ["NBIS"],
  },
  {
    name: "current target 'going to $22' (real: 2065079538623688924)",
    text: `$ZVRA is going to $22.`,
    include: ["ZVRA"],
  },
  {
    name: "recap + genuine current call 'hit $92 next' (real: 2062155007042986175)",
    text: `$IREN now at $69\nI want it to hit $92 next\nThis will mean it has jumped +100% since Serenity told you to sell\nAnd I told you to buy.`,
    include: ["IREN"],
  },
  {
    name: "bearish/caution — not a buy (real: 2064784184653074456)",
    text: `$MU from $1100 down to $850\nIt's a start but not enough\nParabolic moves are red flags`,
    exclude: ["MU"],
  },
  {
    name: "index/market context excluded (real: 2065515603620745355)",
    text: `Clear skies ahead for the market until\nMid July for me\n$NVDA runs this market\nAnd we have it completing its short term pull back now\n4 strong catalysts have ended this week on the market\nLet it rip\n$SPY $QQQ`,
    include: ["NVDA"],
    exclude: ["SPY", "QQQ"],
  },
  {
    name: "bare analyst relay — not the creator's call (real: 2065057657761771696)",
    text: `JPM raises $UNH PT to $466\n\nAnd kept an Overweight rating.`,
    exclude: ["UNH"],
  },
  {
    name: "SYNTHETIC precedence — historical entry + current add → buy",
    text: `Been holding $NVDA since $90 and I'm still adding here. Biggest conviction position I own.`,
    include: ["NVDA"],
  },
  {
    name: "SYNTHETIC endorsed analyst relay → buy",
    text: `JPM raises $UNH PT to $466 and kept Overweight. I agree completely — $UNH is still my biggest position and I'm buying more here.`,
    include: ["UNH"],
  },
  {
    name: "SYNTHETIC watchlist 'on my radar, no position' → not a buy",
    text: `$SOFI is on my radar, watching it closely. No position yet, waiting for a better entry.`,
    exclude: ["SOFI"],
  },
];

async function scoredTickers(text: string): Promise<Set<string>> {
  const body = `TWEET:\n${text}\n\nIMAGE HINTS:\n[]`;
  const cs = await classify(FIREWORKS_MODEL, body, fireworks);
  return new Set(
    cs
      .filter((c) => c.isExplicitBuy && c.direction === "bullish" && c.ticker)
      .map((c) => String(c.ticker).toUpperCase().replace(/^\$+/, "")),
  );
}

const RUN = !!process.env.FIREWORKS_API_KEY && !!process.env.RUN_LLM_EVAL;

describe.skipIf(!RUN)("CLASSIFY_SYS recap-guard eval", () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const scored = await scoredTickers(c.text);
      for (const t of c.include ?? []) expect(scored).toContain(t);
      for (const t of c.exclude ?? []) expect(scored).not.toContain(t);
    }, 30_000);
  }
});
