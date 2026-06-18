"use client";

import { CircleQuestionMark } from "lucide-react";
import { PieChart } from "#/components/charts/pie-chart.tsx";
import { PieSlice } from "#/components/charts/pie-slice.tsx";
import { ChartBoundary } from "#/components/ChartBoundary";
import { usePreferences } from "#/lib/preferences.tsx";
import { useInView } from "#/lib/use-in-view.ts";
import { musaffaKey, STATUS_META, type HalalInfo } from "#/lib/halal/types.ts";

const SLICE = { halal: "#10b981", doubtful: "#f59e0b", notHalal: "#ef4444" } as const;

// AAOIFI financial screens are compliant under ~30% of market cap.
const SCREEN_THRESHOLD = 30;

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium text-foreground tabular-nums">{value.toFixed(0)}%</span>
    </div>
  );
}

function Screen({ label, value }: { label: string; value: number }) {
  const ok = value < SCREEN_THRESHOLD;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-medium tabular-nums ${ok ? "text-foreground" : "text-red-500"}`}>
          {value.toFixed(1)}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className={`h-full rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

// Inline Shariah-compliance panel for the stock page — replaces the hover popup with a
// permanent, richer surface (revenue-composition donut + AAOIFI financial screens +
// Musaffa link). Self-gates on the opt-in toggle; an unrated symbol gets a muted
// "not rated" entry point. `symbol` is the route symbol, used for the lookup link.
export function HalalPanel({ info, symbol }: { info: HalalInfo; symbol: string }) {
  const { showHalalStatus } = usePreferences();
  // Defer the donut mount until it scrolls in — the panel sits below the SPY
  // chart, so its bklit enter animation would otherwise play unseen.
  const [donutRef, donutInView] = useInView<HTMLDivElement>();
  if (!showHalalStatus) return null;

  if (info.status === "unknown") {
    return (
      <section className="rounded-2xl border border-border/60 border-dashed bg-muted/20 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CircleQuestionMark className="size-[1.1em]" />
          Not rated by Musaffa
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          No Shariah screening is available for {symbol} (e.g. crypto or a foreign listing).
        </p>
        <a
          href={`https://musaffa.com/stock/${musaffaKey(symbol)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          Look up on Musaffa ↗
        </a>
      </section>
    );
  }

  const meta = STATUS_META[info.status];
  const data = [
    { label: "Halal", value: info.halalPct, color: SLICE.halal },
    { label: "Doubtful", value: info.doubtfulPct, color: SLICE.doubtful },
    { label: "Non-halal", value: info.notHalalPct, color: SLICE.notHalal },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: meta.fill }} />
          <span className="text-sm font-medium text-foreground">{meta.label}</span>
          {info.sector ? (
            <span className="text-xs text-muted-foreground">· {info.sector}</span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          Shariah · {info.exchange || info.ticker}
        </span>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          {/* Center label overlaid manually: bklit's PieCenter only renders its
              render-prop on hover, falling back to a "Total" label otherwise. */}
          <div className="relative" ref={donutRef} style={{ width: 132, height: 132 }}>
            {donutInView ? (
              <ChartBoundary>
                <PieChart data={data} size={132} innerRadius={46} padAngle={0.03} cornerRadius={3} hoverOffset={4}>
                  {data.map((d, i) => (
                    <PieSlice index={i} key={d.label} />
                  ))}
                </PieChart>
              </ChartBoundary>
            ) : null}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-heading text-xl leading-none text-foreground">
                {info.halalPct.toFixed(0)}%
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                halal rev
              </div>
            </div>
          </div>
          <div className="w-32 space-y-1.5 text-xs">
            <LegendRow color={SLICE.halal} label="Halal" value={info.halalPct} />
            <LegendRow color={SLICE.doubtful} label="Doubtful" value={info.doubtfulPct} />
            <LegendRow color={SLICE.notHalal} label="Non-halal" value={info.notHalalPct} />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-2.5 text-xs">
            <Screen label="Interest-bearing debt" value={info.debtRatio} />
            <Screen label="Interest-bearing securities" value={info.securitiesRatio} />
          </div>
          {info.musaffaUrl ? (
            <a
              href={info.musaffaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
            >
              View full report on Musaffa ↗
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
