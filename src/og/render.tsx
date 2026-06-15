import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ogFonts } from "./fonts";
import { buildCardBackgroundSvg, buildLineChartBackgroundSvg } from "./card-bg";
import { palette, type OgPalette } from "./theme";
import type { OgTheme } from "./solar";

const W = 1200;
const H = 630;

export type OgCard =
  | { kind: "home"; theme: OgTheme }
  | {
      kind: "creator";
      theme: OgTheme;
      name: string;
      handle: string;
      avatar?: string; // base64 data URI
      excess3m: number; // fraction, e.g. 0.124
      totalCalls: number;
    }
  | {
      kind: "ticker";
      theme: OgTheme;
      symbol: string;
      company?: string;
      name: string; // creator name
      handle: string;
      excess3m: number | null;
      closes?: number[]; // symbol price series for the line-graph background
    };

// NOTE: resvg runs twice per render (background here, final card in renderOgPng)
// and the bg is inlined as a base64 data URI. Fine per-request; the /api/og/*
// routes are ISR-cached so this runs once per content rev, not per request.
function svgToUri(svg: string): string {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function signed(x: number): string {
  return `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

// lucide LineChart glyph path data (24x24 viewBox), stroked.
const LINE_CHART_D = "M3 3v16a2 2 0 0 0 2 2h16 M7 16l4-4 3 3 5-6";

function BrandLockup({ pal }: { pal: OgPalette }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${pal.fg}, ${pal.fgMuted})`,
          border: `1px solid ${pal.line}`,
        }}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={pal.bg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={LINE_CHART_D} />
        </svg>
      </div>
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 22, fontWeight: 600, color: pal.fg }}>
        Signal Tracker
      </div>
    </div>
  );
}

// Header row: kicker on the left, brand lockup on the right.
function TopBar({ pal, kicker }: { pal: OgPalette; kicker: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Kicker pal={pal} text={kicker} />
      <BrandLockup pal={pal} />
    </div>
  );
}

function Frame({ pal, bg, children }: { pal: OgPalette; bg: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: W,
        height: H,
        padding: 64,
        position: "relative",
        background: pal.bg,
        color: pal.fg,
      }}
    >
      <img src={bg} width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between", position: "relative" }}>
        {children}
      </div>
    </div>
  );
}

function Kicker({ pal, text }: { pal: OgPalette; text: string }) {
  return (
    <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 22, letterSpacing: 6, textTransform: "uppercase", color: pal.fgMuted }}>
      {text}
    </div>
  );
}

function Stat({ pal, value }: { pal: OgPalette; value: number | null }) {
  const ok = value != null && value >= 0;
  const color = value == null ? pal.fgMuted : ok ? pal.up : pal.down;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 96, fontWeight: 700, lineHeight: 1, color }}>
        {value == null ? "—" : signed(value)}
      </div>
      {/* flex-end + paddingBottom lands the small label on the big number's baseline */}
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 30, lineHeight: 1, paddingBottom: 16, color: pal.fgMuted }}>vs SPY · 3m</div>
    </div>
  );
}

function cardTree(card: OgCard, pal: OgPalette, bg: string): React.ReactElement {
  if (card.kind === "home") {
    return (
      <Frame pal={pal} bg={bg}>
        <TopBar pal={pal} kicker="Influencer accuracy · vs SPY" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 700, fontSize: 56, lineHeight: 1.08, color: pal.fg }}>
            Influencer accuracy,
          </div>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 700, fontSize: 56, lineHeight: 1.08, color: pal.lagoonDeep }}>
            measured against the market.
          </div>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 26, color: pal.fgMuted, marginTop: 10 }}>
            Forward returns of stock calls, net of SPY.
          </div>
        </div>
        <div style={{ display: "flex" }} />
      </Frame>
    );
  }
  if (card.kind === "creator") {
    return (
      <Frame pal={pal} bg={bg}>
        <TopBar pal={pal} kicker="Signal accuracy" />
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {card.avatar ? (
            <img src={card.avatar} width={120} height={120} style={{ borderRadius: 999, border: `2px solid ${pal.line}` }} />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 700, fontSize: 56, lineHeight: 1, color: pal.fg }}>{card.name}</div>
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 30, color: pal.fgMuted }}>@{card.handle} · {card.totalCalls} calls</div>
          </div>
        </div>
        <Stat pal={pal} value={card.excess3m} />
      </Frame>
    );
  }
  return (
    <Frame pal={pal} bg={bg}>
      <TopBar pal={pal} kicker={`@${card.handle}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 20 }}>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 700, fontSize: 96, lineHeight: 1, color: pal.fg }}>{card.symbol}</div>
          {card.company ? (
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 34, lineHeight: 1, paddingBottom: 14, color: pal.fgMuted }}>{card.company}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 600, fontSize: 32, color: pal.fgMuted }}>called by {card.name}</div>
      </div>
      <Stat pal={pal} value={card.excess3m} />
    </Frame>
  );
}

export async function renderOgPng(card: OgCard): Promise<Buffer> {
  const pal = palette(card.theme);
  const seed =
    card.kind === "home"
      ? "signal-tracker"
      : card.kind === "ticker"
        ? `${card.handle}:${card.symbol}` // separator avoids handle/symbol concat collisions
        : card.handle;
  // No-data ticker (null excess) renders neutral-positive (teal); Stat still shows "—".
  const up =
    card.kind === "creator"
      ? card.excess3m >= 0
      : card.kind === "ticker"
        ? (card.excess3m ?? 0) >= 0
        : true;
  // Line color tracks the 3m-excess sign (the card's hero stat), not raw price direction.
  const bgSvg =
    card.kind === "ticker" && card.closes && card.closes.length > 0
      ? buildLineChartBackgroundSvg({
          closes: card.closes,
          up,
          theme: card.theme,
          palette: pal,
          width: W,
          height: H,
        })
      : buildCardBackgroundSvg({ seed, up, theme: card.theme, palette: pal, width: W, height: H });
  const bg = svgToUri(bgSvg);
  const svg = await satori(cardTree(card, pal, bg), { width: W, height: H, fonts: ogFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}

export const OG_WIDTH = W;
export const OG_HEIGHT = H;
