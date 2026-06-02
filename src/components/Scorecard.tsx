import type { Scorecard as SC } from "../lib/types";
import { Card } from "./ui/card";

function pct(x: number) { return `${(x * 100).toFixed(1)}%`; }

export function Scorecard({ sc }: { sc: SC }) {
  const stats = [
    ["Total calls", String(sc.totalCalls)],
    ["Unique tickers", String(sc.uniqueTickers)],
    ["Calls / week", sc.callsPerWeek.toFixed(1)],
    ["Hit rate 1m (beats SPY)", pct(sc.hitRate["1m"])],
    ["Hit rate 3m (beats SPY)", pct(sc.hitRate["3m"])],
    ["Avg excess 1m", pct(sc.avgExcess["1m"])],
    ["Avg excess 3m", pct(sc.avgExcess["3m"])],
    ["Avg excess to date", pct(sc.avgExcess["toDate"])],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(([label, val]) => (
        <Card key={label} className="p-3">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">{val}</div>
        </Card>
      ))}
    </div>
  );
}
