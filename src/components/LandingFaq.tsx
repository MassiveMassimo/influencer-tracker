import { AccordionGroup, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-foreground">{children}</span>
);

// Plain-language glossary for the landing table's columns and scoring model.
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is this site?",
    a: (
      <>
        It tracks the stock calls finfluencers make on social media and scores them against what the
        market actually did. Every bullish &ldquo;buy this&rdquo; post is measured by its forward
        return versus the S&amp;P 500, so a call only counts as good if it beat simply holding the
        index.
      </>
    ),
  },
  {
    q: "What does “vs SPY” mean, and why SPY?",
    a: (
      <>
        SPY is the S&amp;P 500 ETF, the default market benchmark. A pick that rose 8% while the
        market rose 10% didn&rsquo;t add value, so returns are always shown <em>relative</em> to SPY
        rather than on their own. SPY is a deliberately tough, neutral bar: it isn&rsquo;t
        sector-adjusted, so a tech pick that merely rode a tech rally won&rsquo;t look special
        unless it beat the broad market too.
      </>
    ),
  },
  {
    q: "What is excess?",
    a: (
      <>
        The call&rsquo;s return <strong>minus SPY&rsquo;s return</strong> over the same window (also
        called alpha). +5% excess means the stock beat the market by 5 points; a negative number
        means it lagged. The <Mono>Excess 3m</Mono> column is the average excess across the
        creator&rsquo;s scored calls.
      </>
    ),
  },
  {
    q: "What is a hit, and how is hit rate computed?",
    a: (
      <>
        A <strong>hit</strong> is a call whose excess is positive: it beat SPY.{" "}
        <strong>Hit rate</strong> is the share of calls that were hits over a given window.{" "}
        <Mono>Hit 3m</Mono> is the 3-month hit rate, and the small fraction beneath it (e.g.{" "}
        <Mono>7/12</Mono>) is hits over scored calls.
      </>
    ),
  },
  {
    q: "Why can hit rate and excess point different ways?",
    a: (
      <>
        They measure different things. Hit rate is how <em>often</em> a creator beats the market;
        excess is by <em>how much</em>, on average. A few big winners can pull average excess
        positive even when most calls miss (high excess, low hit rate), and a run of small wins
        beside one large loss can do the reverse. So a 43% hit rate sitting next to a{" "}
        <Mono>+11.4%</Mono> excess isn&rsquo;t a contradiction.
      </>
    ),
  },
  {
    q: "What counts as a good score?",
    a: (
      <>
        As a rough anchor: beating SPY more than half the time (hit rate above 50%) with positive
        average excess, across a healthy sample, is the bar, and most creators don&rsquo;t clear it.
        This is a record of past calls, not advice or a prediction of what any creator will pick
        next.
      </>
    ),
  },
  {
    q: "Why is “Calls” bigger than the scored number?",
    a: (
      <>
        <Mono>Calls</Mono> counts every bullish buy call found. The hit-rate fraction (e.g.{" "}
        <Mono>76/177</Mono>) counts only the <em>first</em> call per ticker that has enough forward
        price history to score. A creator with 880 calls may have far fewer unique, scorable first
        calls: the big number is activity, the fraction is what accuracy is measured on.
      </>
    ),
  },
  {
    q: "What are 1w / 1m / 3m / to date?",
    a: (
      <>
        Forward horizons measured from each post&rsquo;s date: one week, one month, three months,
        and from the post until today. Returns are taken from the post date <em>forward</em>, not
        the entry price a creator brags about after the fact.
      </>
    ),
  },
  {
    q: "What counts as a call?",
    a: (
      <>
        Only explicit bullish buy calls are scored: clear &ldquo;I&rsquo;m buying / you should own
        this&rdquo; statements. Neutral mentions, bearish takes, and vague hype are tracked but
        excluded from accuracy. If a creator pushes the same ticker repeatedly, only the{" "}
        <strong>first call</strong> per ticker counts, so a single name can&rsquo;t be
        double-credited.
      </>
    ),
  },
  {
    q: "Why are some creators flagged “low” and ranked last?",
    a: (
      <>
        Fewer than 10 scored calls is too thin a sample to trust, so those creators are flagged{" "}
        <span className="text-amber-600 dark:text-amber-400">low</span> and sorted below everyone
        else, <em>regardless of their hit rate</em>. That&rsquo;s why a creator showing 57% can sit
        below one showing 43%: a high rate on a handful of calls is luck, not skill.
      </>
    ),
  },
  {
    q: "What are the limits of these numbers?",
    a: (
      <>
        Deleted losing-call posts can&rsquo;t be scraped, so a creator&rsquo;s accuracy is an{" "}
        <strong>upper bound</strong>. Calls are auto-extracted by a language model from posts and
        captions, which isn&rsquo;t perfect. Tap any call on a creator&rsquo;s page to see the
        original post and the exact quote it was scored on.
      </>
    ),
  },
];

export function LandingFaq() {
  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-surface-2">
      <div className="border-b border-border/40 px-5 py-3 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        How to read this
      </div>
      <AccordionGroup radius="rounded-md" ringRadius="rounded-md" className="w-full px-2 py-2">
        {FAQ.map(({ q, a }, i) => (
          <AccordionItem key={q} index={i} value={q}>
            <AccordionTrigger>{q}</AccordionTrigger>
            <AccordionContent className="max-w-prose leading-relaxed">{a}</AccordionContent>
          </AccordionItem>
        ))}
      </AccordionGroup>
    </section>
  );
}
