import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";

// Plain-language glossary for the landing table's columns and scoring model.
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is this site?",
    a: (
      <>
        It tracks the stock calls finfluencers make on social media and scores
        them against what the market actually did. Every bullish &ldquo;buy
        this&rdquo; post is measured by its forward return versus the S&amp;P
        500 — so a call only counts as good if it beat simply holding the index.
      </>
    ),
  },
  {
    q: "What does “vs SPY” mean?",
    a: (
      <>
        SPY is the S&amp;P 500 ETF — the market benchmark. A pick that rose 8%
        while the market rose 10% didn&rsquo;t add value, so returns are always
        shown <em>relative</em> to SPY rather than on their own.
      </>
    ),
  },
  {
    q: "What is excess?",
    a: (
      <>
        The call&rsquo;s return <strong>minus SPY&rsquo;s return</strong> over
        the same window (also called alpha). +5% excess means the stock beat the
        market by 5 points; a negative number means it lagged. The{" "}
        <span className="font-mono text-foreground">Excess 3m</span> column is
        the average across the creator&rsquo;s calls.
      </>
    ),
  },
  {
    q: "What is a hit, and how is hit rate computed?",
    a: (
      <>
        A <strong>hit</strong> is a call whose excess is positive — it beat SPY.{" "}
        <strong>Hit rate</strong> is the share of calls that were hits over a
        given window. <span className="font-mono text-foreground">Hit 3m</span>{" "}
        is the 3-month hit rate; the small fraction beneath it (e.g.{" "}
        <span className="font-mono text-foreground">7/12</span>) is hits over
        scored calls.
      </>
    ),
  },
  {
    q: "What are 1w / 1m / 3m / to date?",
    a: (
      <>
        Forward horizons measured from each post&rsquo;s date: one week, one
        month, three months, and from the post until today. Returns are taken
        from the post date <em>forward</em> — not the entry price a creator
        brags about after the fact.
      </>
    ),
  },
  {
    q: "What counts as a call?",
    a: (
      <>
        Only explicit bullish buy calls are scored — clear &ldquo;I&rsquo;m
        buying / you should own this&rdquo; statements. Neutral mentions,
        bearish takes, and vague hype are tracked but excluded from accuracy. If
        a creator pushes the same ticker repeatedly, only the{" "}
        <strong>first call</strong> per ticker counts, so a single name
        can&rsquo;t be double-credited.
      </>
    ),
  },
  {
    q: "Why are some rows flagged “low”?",
    a: (
      <>
        Fewer than 10 scored calls is too thin a sample to trust, so those
        creators are flagged <span className="text-amber-600 dark:text-amber-400">low</span>{" "}
        and ranked last. A high hit rate on 3 calls is luck, not skill.
      </>
    ),
  },
  {
    q: "What are the limits of these numbers?",
    a: (
      <>
        Deleted losing-call posts can&rsquo;t be scraped, so a creator&rsquo;s
        accuracy is an <strong>upper bound</strong>. Calls are auto-extracted by
        a language model from posts and captions, which isn&rsquo;t perfect.
        Tap any call on a creator&rsquo;s page to see the original post and the
        exact quote it was scored on.
      </>
    ),
  },
];

export function LandingFaq() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
      <div className="border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        How to read this
      </div>
      <Accordion type="single" collapsible className="px-5">
        {FAQ.map(({ q, a }) => (
          <AccordionItem key={q} value={q}>
            <AccordionTrigger>{q}</AccordionTrigger>
            <AccordionContent className="max-w-prose leading-relaxed">
              {a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
