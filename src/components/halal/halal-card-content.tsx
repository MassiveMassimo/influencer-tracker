"use client";

import { Gauge } from "#/components/charts/gauge.tsx";
import { ChartBoundary } from "#/components/ChartBoundary";
import { purityFraction, type HalalInfo } from "#/lib/halal/types.ts";

// Per-status label + semantic gauge fill (emerald/amber/red, matching the badge colors).
const STATUS: Record<HalalInfo["status"], { label: string; fill: string }> = {
  halal: { label: "Shariah-compliant", fill: "#10b981" },
  doubtful: { label: "Compliance questionable", fill: "#f59e0b" },
  not_halal: { label: "Not compliant", fill: "#ef4444" },
  unknown: { label: "Compliance unknown", fill: "#94a3b8" },
};

export function HalalCardContent({ info }: { info: HalalInfo }) {
  return (
    <div className="w-64 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {STATUS[info.status].label}
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
            // Solid status color (green/amber/red); theme-aware neutral track.
            activeFill={STATUS[info.status].fill}
            inactiveFill="var(--chart-background)"
            inactiveFillOpacity={0.4}
            defaultLabel=""
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
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          View on Musaffa ↗
        </a>
      ) : null}
    </div>
  );
}
