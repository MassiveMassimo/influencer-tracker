import { describe, expect, test } from "bun:test";
import { classify } from "./calls";
import { llm, TEXT_MODEL } from "./llm";

// Labeled LLM eval pinning the recap/track-record discriminator in CLASSIFY_SYS
// (see calls.ts bake-off note). It hits the live LLM ($ + network), so it is gated on
// GEMINI_API_KEY && RUN_LLM_EVAL and skipped by a plain `bun test`. Run it after
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
    // Only assert the robust behavior — index exclusion. Whether "$NVDA runs this
    // market" is an explicit buy vs bullish-context is genuinely borderline and flips
    // run-to-run, so it is not a stable eval assertion.
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
  {
    name: "counterfactual hindsight 'you didn't buy $X at $low' — not calls (real: 2027338942778093861)",
    text: `You didn't Buy $AMD at $84 but like it at $200\n\nYou didn't Buy $NVDA at $90 but like it at $190\n\nYou didn't Buy $TSLA at $110 but considering it at $400\n\nYou didn't Buy $GOOG at $140 but like it at $300\n\nYou didn't Buy $BABA at $75 but like it at $150\n\nYou didn't Buy $PLTR at $9 but like it now at $130\n\nRotate from overvalued to undervalued and don't be afraid`,
    exclude: ["AMD", "NVDA", "TSLA", "GOOG", "PLTR"],
  },
  {
    name: "past-performance recap 'gains of the year' — not calls (real: 1973870591154565292)",
    text: `Easiest gains of the year $ETH\n\nSafest gains of the year SILVER\n\nMost rewarding $HIMS\n\nMost satisfying $OSCR\n\nMost relief $BIDU\n\nClearest Buy $UNH at $250\n\nSmartest gains of the year $ADUR, $ASTS, $ZETA`,
    exclude: ["ETH", "HIMS", "OSCR", "BIDU"],
  },
  {
    name: "performance gloat 'running this week / always winning' — not calls (real: 2010747220241301832)",
    text: `It's $ZETA, $ADUR, $ASTS, $ONDS, $NVO, running one week\n\nThe next its $BABA, $BIDU, Silver, Palladium running the next week\n\nAlways winning.`,
    exclude: ["ZETA", "ADUR", "ASTS", "ONDS", "NVO", "BABA", "BIDU"],
  },
  {
    name: "current pick list 'bullish set ups right now' — still calls (real: 2008149865529036967)",
    text: `Very obvious bullish set ups right now:\n\n$BABA\n$ZETA\n$ADUR\n$BIDU\n$JD\n$GRAB\n$ASTS\n$NVO`,
    include: ["BABA", "ZETA", "ADUR"],
  },
  // --- hardening-block regressions (migration 2026-07-19) ---
  {
    name: "HARDENED rule 1 — emit the SYMBOL, and NOW (ServiceNow) is not SNOW (Snowflake)",
    text: `ServiceNow is my highest-conviction buy here, loading up. Do not confuse it with Snowflake.`,
    include: ["NOW"],
    exclude: ["SNOW"],
  },
  {
    name: "HARDENED rule 3 — quality ranking with an explicit no-trade → not buys",
    text: `Ranking the chip names purely on quality: $NVDA best, $AMD second, $INTC worst. Just a tier list, not making any moves or taking any positions today.`,
    exclude: ["NVDA", "AMD", "INTC"],
  },
  {
    name: "HARDENED rule 3 — profit-taking / target reached → not a buy",
    text: `Taking profits on $AMD here — it hit my target at $200 and I'm locking in the gains. Trimming the position.`,
    exclude: ["AMD"],
  },
];

async function scoredTickers(text: string): Promise<Set<string>> {
  const body = `TWEET:\n${text}\n\nIMAGE HINTS:\n[]`;
  const cs = await classify(TEXT_MODEL, body, llm);
  return new Set(
    cs
      .filter((c) => c.isExplicitBuy && c.direction === "bullish" && c.ticker)
      .map((c) => String(c.ticker).toUpperCase().replace(/^\$+/, "")),
  );
}

const RUN =
  (!!process.env.GEMINI_API_KEY || !!process.env.LLM_API_KEY) && !!process.env.RUN_LLM_EVAL;

describe.skipIf(!RUN)("CLASSIFY_SYS recap-guard eval", () => {
  for (const c of CASES) {
    test(
      c.name,
      async () => {
        const scored = await scoredTickers(c.text);
        for (const t of c.include ?? []) expect(scored).toContain(t);
        for (const t of c.exclude ?? []) expect(scored).not.toContain(t);
      },
      60_000,
    ); // generous: long multi-ticker tweets + LLM 5xx backoff can exceed 30s
  }
});
