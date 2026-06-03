import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ogFonts } from "./fonts";
import { buildCardBackgroundSvg } from "./card-bg";
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
    };

// NOTE: resvg runs twice per render (background here, final card in renderOgPng)
// and the bg is inlined as a base64 data URI. Fine per-request; add caching if
// this is ever called in a tight loop (e.g. static-generating every creator).
function cardBgUri(seed: string, up: boolean, theme: OgTheme, pal: OgPalette): string {
  const svg = buildCardBackgroundSvg({ seed, up, theme, palette: pal, width: W, height: H });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function signed(x: number): string {
  return `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

// lucide LineChart glyph path data (24x24 viewBox), stroked.
const LINE_CHART_D = "M3 3v16a2 2 0 0 0 2 2h16 M7 16l4-4 3 3 5-6";

function BrandFooter({ pal }: { pal: OgPalette }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `linear-gradient(135deg, ${pal.fg}, ${pal.fgMuted})`,
          border: `1px solid ${pal.line}`,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={pal.bg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={LINE_CHART_D} />
        </svg>
      </div>
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 26, fontWeight: 600, color: pal.fg }}>
        Signal Tracker
      </div>
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
    <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 96, fontWeight: 600, color }}>
        {value == null ? "—" : signed(value)}
      </div>
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 30, color: pal.fgMuted }}>vs SPY · 3m</div>
    </div>
  );
}

function cardTree(card: OgCard, pal: OgPalette, bg: string): React.ReactElement {
  if (card.kind === "home") {
    return (
      <Frame pal={pal} bg={bg}>
        <Kicker pal={pal} text="Signal Tracker · vs SPY" />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 84, lineHeight: 1, color: pal.fg }}>
            Influencer accuracy,
          </div>
          <div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 84, lineHeight: 1, color: pal.lagoonDeep }}>
            measured against the market.
          </div>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 28, color: pal.fgMuted, marginTop: 8 }}>
            Forward returns of stock calls, net of SPY.
          </div>
        </div>
        <BrandFooter pal={pal} />
      </Frame>
    );
  }
  if (card.kind === "creator") {
    return (
      <Frame pal={pal} bg={bg}>
        <Kicker pal={pal} text="Signal accuracy" />
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {card.avatar ? (
            <img src={card.avatar} width={120} height={120} style={{ borderRadius: 999, border: `2px solid ${pal.line}` }} />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 64, color: pal.fg }}>{card.name}</div>
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 30, color: pal.fgMuted }}>@{card.handle} · {card.totalCalls} calls</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Stat pal={pal} value={card.excess3m} />
          <BrandFooter pal={pal} />
        </div>
      </Frame>
    );
  }
  return (
    <Frame pal={pal} bg={bg}>
      <Kicker pal={pal} text={`@${card.handle}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 600, fontSize: 96, color: pal.fg }}>{card.symbol}</div>
          {card.company ? (
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 34, color: pal.fgMuted }}>{card.company}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 36, color: pal.fgMuted }}>called by {card.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Stat pal={pal} value={card.excess3m} />
        <BrandFooter pal={pal} />
      </div>
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
  const bg = cardBgUri(seed, up, card.theme, pal);
  const svg = await satori(cardTree(card, pal, bg), { width: W, height: H, fonts: ogFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}

export const OG_WIDTH = W;
export const OG_HEIGHT = H;
