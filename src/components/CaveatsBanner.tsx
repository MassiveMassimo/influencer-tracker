const TEXT: Record<string, string> = {
  survivorship: "Deleted losing-call reels can't be scraped — accuracy shown is an upper bound.",
  "reposts-deduped": "Repeated promotions are counted once (first bullish mention per ticker).",
  "forward-from-post-date": "Returns are measured from each reel's post date forward — not the gains he brags about.",
};

export function CaveatsBanner({ caveats }: { caveats: string[] }) {
  return (
    <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
      <div className="font-semibold mb-1">How to read this</div>
      <ul className="list-disc pl-5 space-y-0.5">
        {caveats.map(c => <li key={c}>{TEXT[c] ?? c}</li>)}
      </ul>
    </div>
  );
}
