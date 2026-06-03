# CLAUDE.md — influencer-tracker

Scores finfluencer stock calls against forward prices vs SPY. Each creator is a
self-contained dataset under `data/creators/<handle>/`; the dashboard (TanStack
Start) reads `dataset.json`. Two ingestion pipelines feed the **same** downstream
contract, so scoring and the UI are platform-agnostic.

## Pipelines

Both end identically: `reel-calls.json` (a `ReelCall[]`) → `prices` → `score` →
`dataset.json`. Each pauses after `extract` for human review of `calls.review.md`
before pricing. Resume with `--from <stage>`.

- **Instagram** — `bun run pipeline --handle <h> --name "<Name>"`
  Stages: `scrape → transcribe → frames → extract → prices → score`.
- **X/Twitter** — `bun run pipeline:x --handle <h> --name "<Name>"`
  Stages: `scrape → extract → prices → score`.

## How we scrape

**Instagram** (`pipeline/scrape.ts`, video-first):
- Playwright + stealth, persistent `.chrome-profile` (headful). On a fresh
  profile it **waits for manual IG login** (polls for the `ds_user_id` cookie)
  before scrolling — don't automate the login.
- Harvests shortcodes + dates from intercepted GraphQL while scrolling the
  `/reels/` page back to the cutoff (default 12 months).
- Downloads each reel with `yt-dlp`, reusing the session via an exported
  Netscape cookie jar (`data/creators/<h>/cookies.txt`, gitignored).
- Then: `transcribe` (Groq Whisper), `frames` (sample 3 frames → Groq vision
  for on-screen ticker/price hints), `extract`.

**X/Twitter** (`pipeline/x/scrape-x.ts`, text-first):
- Rettiwt-API, authenticated by `RETTIWT_API_KEY` — a base64 cookie key from a
  **throwaway** X account (never a real one). See `.env.example` for how to
  build it from the `auth_token`/`ct0`/`kdt`/`twid` cookies.
- `tweet.search` with `onlyOriginal` (no retweets/replies) over `[cutoff, now]`.
  A single search caps at ~3,200 tweets, so we **walk backwards in date windows**
  (`endDate = oldest seen`, dedupe by id) to cover the full range.
- Transient `404/429/5xx` are retried with backoff (`isTransient`) — X
  load-sheds with 404s mid-pagination; don't treat them as fatal.
- Downloads attached images (https only) to `raw/<tweetId>/img_*.jpg` for the
  vision step in `extract-x`.

## What to extract per call

The shared classifier (`pipeline/calls.ts`, `CLASSIFY_SYS`) returns, per post:
`ticker`, `company`, `direction` (bullish/bearish/neutral), `isExplicitBuy`,
`conviction` (0–1), `quote` (the verbatim call), `onScreenPrice`, and `summary`
(one neutral sentence, <160 chars, on what the post is about + the thesis).
`shortcode` = IG reel code or X tweet id; `postDate` = post date.

**Only explicit bullish calls** (`isExplicitBuy && direction === "bullish"`) are
scored. Accuracy = forward return vs SPY (excess) at 1w/1m/3m/to-date.

## Proof embeds

Each call links to its source via `shortcode`: numeric ⇒ X tweet embed, otherwise
⇒ IG reel embed (`/reel/<code>/embed`). On the ticker page, tapping a call row
opens `ProofViewer` (`src/components/proof-viewer.tsx`) — a Radix dialog on
desktop and a vaul drawer on mobile (switched via `useMediaQuery`, 768px) — that
shows the embed + summary + quote. No local media is needed for display.

## Profile pics

Platform-agnostic, like the `ReelCall` contract. Each scraper resolves its own
avatar URL and calls `saveAvatar(handle, url)` (`pipeline/avatar.ts`), which
downloads the bytes and writes a base64 data URI to `data/creators/<h>/avatar.txt`
(inlined because CDN avatar URLs are signed and expire). `score.ts` reads that
into the `index.json` entry's `avatar` field; `WorkspaceRail` renders it, falling
back to an icon. IG resolves via `web_profile_info`, X via Rettiwt
`user.details().profileImage`. A new platform (e.g. TikTok) only needs to resolve
its URL and call `saveAvatar` — downstream is already universal.

## Conventions

- **Tests run on `bun test`** (files import `bun:test`, NOT vitest). Typecheck
  with `bunx tsc --noEmit`. The `#/` alias maps to `src/`.
- The X path reuses `prices.ts`/`score.ts`/`scorecard.ts`/the dashboard
  unchanged — keep new platforms emitting the `ReelCall` shape, don't fork them.
- Secrets in `.env` (gitignored): `GROQ_API_KEY`, `RETTIWT_API_KEY`. Groq
  free-tier is rate-limited; `pipeline/groq.ts` backs off on 429 — expect slow
  vision/extract stages, not failures.
- Charts: bklit Gauge/Funnel + candlestick/line are time-series (x must be a
  Date); categorical analytics use native SVG. Wrap charts in `ChartBoundary`.
