import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getDataset } from "../lib/data";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import type { Call } from "#/lib/types.ts";
import { CandlestickChart } from "#/components/charts/candlestick-chart.tsx";
import { Candlestick } from "#/components/charts/candlestick.tsx";
import { LineChart, Line } from "#/components/charts/line-chart.tsx";
import { Grid } from "#/components/charts/grid.tsx";
import { XAxis } from "#/components/charts/x-axis.tsx";
import { ChartTooltip } from "#/components/charts/tooltip/chart-tooltip.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { ChartBoundary } from "../components/ChartBoundary";

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  component: TickerPage,
});

function pct(x: number | null) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function toneClass(x: number | null) {
  if (x == null) return "text-muted-foreground";
  return x > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : x < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
}

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const ohlc = ds.tickers[symbol]?.ohlc ?? [];
  const spy = ds.tickers["SPY"]?.ohlc ?? [];
  const calls = ds.calls.filter((c) => c.ticker === symbol);
  const callDates = new Set(calls.map((c) => c.postDate));
  const [openProof, setOpenProof] = useState<string | null>(null);

  const candles = ohlc.map((b) => ({
    date: new Date(b.date),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));

  const base = ohlc[0]?.c ?? 1;
  const spyBase = spy[0]?.c ?? 1;
  const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
  const norm = ohlc.map((b) => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
    call: callDates.has(b.date) ? (b.c / base) * 100 : null,
  }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Ticker · @{ds.creator.handle}
        </div>
        <h1 className="mt-1 flex items-baseline gap-2 font-heading text-2xl">
          {symbol}
          <span className="text-base text-muted-foreground">{calls[0]?.company}</span>
        </h1>
      </header>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Price
        </div>
        <ChartBoundary>
          <CandlestickChart data={candles} style={{ height: 320 }}>
            <Grid horizontal />
            <Candlestick fadedOpacity={0.25} />
            <XAxis />
            <ChartTooltip />
          </CandlestickChart>
        </ChartBoundary>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Stock vs SPY · rebased to 100 · markers are call dates
        </div>
        <ChartBoundary>
          <LineChart data={norm}>
            <Grid horizontal highlightRowValues={[100]} />
            <Line dataKey="stock" />
            <Line dataKey="spy" stroke="var(--chart-3)" />
            <Line dataKey="call" showMarkers stroke="transparent" />
            <XAxis />
            <ChartTooltip />
          </LineChart>
        </ChartBoundary>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Calls & forward return vs SPY · click a row for proof
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Date</TableHead>
              <TableHead className="text-right">1w</TableHead>
              <TableHead className="text-right">1m</TableHead>
              <TableHead className="text-right">3m</TableHead>
              <TableHead className="text-right">To date</TableHead>
              <TableHead>Quote</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => {
              const open = openProof === c.shortcode;
              const p = proof(c.shortcode);
              return (
                <Fragment key={c.shortcode}>
                  <TableRow
                    aria-expanded={open}
                    onClick={() => setOpenProof(open ? null : c.shortcode)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-muted-foreground">
                      <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
                        ›
                      </span>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {c.postDate}
                      {c.isFirstCall ? " ★" : ""}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1w"].excess)}`}>
                      {pct(c.returns["1w"].excess)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1m"].excess)}`}>
                      {pct(c.returns["1m"].excess)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${toneClass(c.returns["3m"].excess)}`}>
                      {pct(c.returns["3m"].excess)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${toneClass(c.returns["toDate"].excess)}`}>
                      {pct(c.returns["toDate"].excess)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{c.quote}</TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="whitespace-normal bg-muted/30 p-5">
                        <div className="flex flex-col gap-5 md:flex-row md:items-start">
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                                {p.kind === "tweet" ? "Tweet" : "Reel"} · proof
                              </span>
                              <a
                                href={p.source}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                              >
                                Open original ↗
                              </a>
                            </div>
                            {c.summary && (
                              <div className="space-y-1">
                                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                                  What the post is about
                                </div>
                                <p className="text-sm leading-relaxed text-foreground">{c.summary}</p>
                              </div>
                            )}
                            <div className="space-y-1">
                              <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                                Quote
                              </div>
                              <p className="text-sm leading-relaxed text-muted-foreground">“{c.quote}”</p>
                            </div>
                          </div>
                          <iframe
                            src={p.embed}
                            title={`Proof for ${c.ticker} call on ${c.postDate}`}
                            loading="lazy"
                            className="mx-auto block w-full max-w-[420px] shrink-0 rounded-xl border border-border/60 bg-background md:mx-0"
                            style={{ height: p.kind === "tweet" ? 560 : 640 }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
