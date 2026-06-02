import { Link } from "@tanstack/react-router";
import type { Call } from "../lib/types";

export function Timeline({ handle, calls }: { handle: string; calls: Call[] }) {
  const sorted = [...calls].sort((a, b) => a.postDate.localeCompare(b.postDate));
  const t0 = new Date(sorted[0]?.postDate ?? Date.now()).getTime();
  const t1 = new Date(sorted.at(-1)?.postDate ?? Date.now()).getTime();
  const span = Math.max(t1 - t0, 1);
  return (
    <div className="relative h-24 w-full rounded-md border bg-card">
      {sorted.map((c, i) => {
        const x = ((new Date(c.postDate).getTime() - t0) / span) * 96 + 2;
        const ex = c.returns.toDate.excess;
        const color = ex == null ? "bg-muted" : ex >= 0 ? "bg-green-500" : "bg-red-500";
        return (
          <Link key={c.shortcode + i} to="/c/$handle/ticker/$symbol"
            params={{ handle, symbol: c.ticker }}
            className={`absolute top-1/2 -translate-y-1/2 size-3 rounded-full ${color} ring-2 ring-background`}
            style={{ left: `${x}%` }} title={`${c.ticker} ${c.postDate} ${ex != null ? (ex*100).toFixed(0)+"% vs SPY" : "pending"}`} />
        );
      })}
    </div>
  );
}
