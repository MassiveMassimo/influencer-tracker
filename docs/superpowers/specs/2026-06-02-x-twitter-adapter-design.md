# X/Twitter Ingestion Adapter — Design

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Context:** Extends the `influencer-tracker` project (see
`2026-06-02-influencer-signal-tracker-design.md`) to a second platform so
text-first finfluencers like [@TheProfInvestor](https://x.com/TheProfInvestor)
can be tracked alongside Instagram creators such as @kevvonz.

## Goal

Add an X/Twitter ingestion + extraction path that produces a dataset
**byte-compatible** with the existing pipeline output, so the scoring stages and
the entire dashboard work unchanged. An X creator becomes "just another"
`data/creators/<handle>/` dataset.

## Why this is a separate path (not a tweak to the IG scraper)

The Instagram pipeline is video-first: `yt-dlp` download → Whisper transcription
→ frame sampling → vision hints → LLM extraction. @TheProfInvestor posts **text
tweets, sometimes with chart images** — there is no audio. The download/Whisper/
frames chain is irrelevant. Ingestion and extraction are genuinely different;
everything downstream is identical.

## Architecture

```
Rettiwt-API  ──>  tweets.json + raw/<id>/img_*.jpg   (scrape-x)
                       │
                       ▼
   vision(images) + classifyCall(text+hints)  ──>  reel-calls.json + calls.review.md   (extract-x)
                       │  [PAUSE: human reviews calls.review.md]
                       ▼
              prices.ts  ──>  score.ts  ──>  dataset.json   (UNCHANGED)
                       │
                       ▼
                  dashboard (UNCHANGED)
```

The contract between halves is the existing intermediate type `ReelCall[]`
(`src/lib/types.ts`), written to `data/creators/<handle>/reel-calls.json`. If
`extract-x` emits the same shape, `prices.ts` and `score.ts` consume it with no
changes. The name `reel-calls.json` is kept as-is (platform-neutral enough; not
worth a rename churn across the scoring stages).

## Ingestion: Rettiwt-API

Chosen after researching the June-2026 state of free X scraping. snscrape and
Nitter are dead; the maintained options all ride a logged-in account's cookies.
Rettiwt-API is native TypeScript (fits the Bun stack), actively maintained
(May 2026), and returns full tweet text + timestamp + id + media URLs.

- **Auth:** `RETTIWT_API_KEY` env var (base64 cookie key from a **throwaway**
  X account — never the user's main; single-account ban risk over a year of
  scraping is low but nonzero). Read lazily, same pattern as `GROQ_API_KEY`.
- **Fetch:** user timeline for the last `months` (default 12). X enforces a hard
  **~3,200-tweet ceiling** on any user timeline across all tools. If the fetch
  hits that ceiling before reaching the cutoff date, fall back to dated search
  windows (`from:<handle> since:<d1> until:<d2>`) to fill the gap, and **log a
  caveat** if coverage is still truncated. Never silently cap.
- **Rate limits:** Rettiwt surfaces X rate-limit errors; wrap calls in the same
  backoff helper used for Groq (retry with delay, capped attempts).
- **Output:** `tweets.json` = array of `{ id, createdAt, text, imageUrls[] }`.
  Download each image URL to `raw/<id>/img_<n>.jpg`.

## Extraction: extract-x

For each tweet:

1. If it has images, run the vision model on each (reuse the shared image-read
   helper) to capture on-screen ticker/price hints — this catches calls stated
   only inside a chart screenshot.
2. Run the **shared classifier** on `text + image hints` to decide explicit
   bullish call, ticker, company, direction, conviction, quote, price.
3. Map to `ReelCall`: `shortcode = tweet id`, `postDate = createdAt` as
   `YYYY-MM-DD`, `quote = tweet text`, `onScreenPrice` from vision.

Write `reel-calls.json` + `calls.review.md` exactly as the IG `extract` does.

## Targeted refactor (DRY)

The bullish-call classification (the `SYS` prompt + Groq chat call + JSON parse)
and the review/JSON writer currently live inside `pipeline/extract.ts`; the
single-frame vision call lives inside `pipeline/frames.ts`. To avoid two
diverging definitions of "what counts as a call," lift the shared logic:

- `pipeline/calls.ts` — `classifyCall(textBody, hints)` returning the parsed
  classification, plus `writeCalls(handle, calls)` (writes `reel-calls.json` +
  `calls.review.md`). Both `extract.ts` and `extract-x.ts` use these.
- `pipeline/vision.ts` — `readImage(visionModel, imgPath)` returning
  `{ ticker, price }`. Both `frames.ts` and `extract-x.ts` use it.

`extract.ts` and `frames.ts` are refactored to call the shared helpers; their
observable behavior (and the IG dataset output) is unchanged — verified by the
existing IG fixture still producing the same `reel-calls.json`.

## Orchestrator: run-x.ts

Mirrors `run.ts`: stages `["scrape", "extract", "prices", "score"]` with
`--from` resume support and the same PAUSE after `extract` so the human reviews
`calls.review.md` before pricing. Usage:
`bun run pipeline:x --handle TheProfInvestor --name "The Prof Investor"`.

## Error handling

- Missing `RETTIWT_API_KEY` → clear error naming the env var (lazy, not at
  module load).
- Rettiwt rate-limit / transient errors → backoff + retry, capped.
- Tweet with no text and no readable image → skipped (logged), not crashed.
- Malformed LLM JSON → skip that tweet (logged), continue (same as IG extract).
- 3,200 ceiling reached with date gap remaining → caveat appended to dataset.

## Testing

- **Unit (deterministic):** the tweet→`ReelCall` mapping — date formatting
  (`createdAt` → `YYYY-MM-DD`), ticker uppercasing, schema conformance, and the
  classifier's JSON-parse/normalize path against fixture LLM responses (mock the
  Groq call). No live network.
- **Shared-helper parity:** a test asserting the refactored `extract.ts` still
  emits the same `ReelCall` for the existing NBIS IG fixture (guards the
  refactor).
- **Integration (manual):** a real `scrape-x` run requires a throwaway-account
  key; validated by hand, not in CI.

## Out of scope

- Threads/quote-tweets as multi-part calls — each tweet is treated independently
  for v1.
- Retweets/replies — excluded from the timeline fetch (own original posts only).
- Real-time/streaming updates — this is a batch backfill, same as IG.

## Caveats (surfaced in the dashboard, carried over)

Survivorship bias, forward-return-from-post-date methodology, repost/duplicate
handling, and excess-return-vs-SPY accuracy all apply identically. New X-specific
caveat: timeline coverage may be truncated at ~3,200 tweets if the account is
very high-volume.
