"use client";

import { Gauge } from "#/components/charts/gauge.tsx";
import { ChartBoundary } from "#/components/ChartBoundary";
import { purityFraction, type HalalInfo } from "#/lib/halal/types.ts";

const LABEL: Record<HalalInfo["status"], string> = {
  halal: "Shariah-compliant",
  doubtful: "Compliance questionable",
  not_halal: "Not compliant",
  unknown: "Compliance unknown",
};

export function HalalCardContent({ info }: { info: HalalInfo }) {
  return (
    <div className="w-64 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {LABEL[info.status]}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
          {info.exchange || info.ticker}
        </span>
      </div>
      <div className="flex justify-center">
        <ChartBoundary>
          <Gauge
            width={112}
            height={84}
            value={info.halalPct}
            // centerValue must be the 0–1 fraction — Intl style:"percent" multiplies ×100
            centerValue={purityFraction(info.halalPct)}
            formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
            useGradient
            activeGradient={["#a855f7", "#06b6d4"]}
            inactiveGradient={["#334155", "#38bdf8"]}
            inactiveFillOpacity={0.4}
            startAngle={140}
            endAngle={400}
            notchCornerRadius={7}
            spacing={0}
          />
        </ChartBoundary>
      </div>
      <p className="text-xs text-muted-foreground">
        Halal {info.halalPct.toFixed(0)}% · doubtful {info.doubtfulPct.toFixed(0)}% · non-halal{" "}
        {info.notHalalPct.toFixed(0)}%
      </p>
      {info.musaffaUrl ? (
        <a
          href={info.musaffaUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Popup may live inside a row-level <Link>; stop the click bubbling so the
          // external link opens without the router also navigating the underlying row.
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          View on Musaffa ↗
        </a>
      ) : null}
    </div>
  );
}
