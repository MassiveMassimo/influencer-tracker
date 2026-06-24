import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Routes exercised by the suite. Picked to cover the three render profiles:
// home (lists), creator overview (stat tiles + cum-excess curve), ticker
// (the chart-heavy candle/area morph that dominates render cost).
export const ROUTES = {
  home: '/',
  creator: '/c/TheProfInvestor',
  ticker: '/t/VRT/all',
} as const

// Soft budgets — generous on purpose (~1.4x current measured values) so the suite
// flags real regressions, not normal jitter. Tighten once a baseline settles.
// Baseline (2026-06-24, dev, this machine): ~6400 renders/switch over 12 switches,
// ~10 commits/switch, ~650 components re-rendered PER animation frame. The high
// render count is the per-frame morph animation + by-design marker remount/restagger;
// it is machine-relative (faster CPU = more frames), so watch the trend + the
// component breakdown (a NEW component entering the top list = a real regression),
// not the absolute number across different machines.
export const BUDGETS = {
  rendersPerSwitch: 9000, // baseline ~6500
  commitsPerSwitch: 16, // baseline ~10
  jsTransferKB: 1200, // baseline: ticker 1026, creator 968, home 674 — ticker is heavy
  totalTransferKB: 3000, // baseline ~1250
  lcpMs: 4000, // baseline <500 (local; field will be higher)
  fcpMs: 2500,
  ttfbMs: 1500,
  cls: 0.1, // baseline: creator 0.067 (stat-tile reveal), others ~0
  longTaskTotalMs: 2000,
  loafMaxBlockingMs: 400,
  // baseline 28.7MB/28 switches — likely bounded TanStack Query timeframe cache,
  // not a leak; 40 gives GC-jitter headroom. If this climbs with more CYCLES, investigate.
  heapGrowthMB: 40,
} as const

// ── Render counter (dev project only) ───────────────────────────────────────
// Injected at document_start AFTER react-scan's install-hook.global.js, which
// installs the RDT hook before React mounts so React records `actualDuration`
// per fiber. We chain onCommitFiberRoot and tally every fiber that did work
// (actualDuration > 0) this commit, keyed by component display name.
// Self-contained: runs in page context, no closure over module scope.
export function renderCounterInit() {
  const KEY = '__perf'
  ;(window as any)[KEY] = { counts: {}, commits: 0, sawDur: false }
  const hookName = '__REACT_DEVTOOLS_GLOBAL_HOOK__'
  const wrap = () => {
    const hook = (window as any)[hookName]
    if (!hook || hook.__perfWrapped) return !!(hook && hook.__perfWrapped)
    const orig = hook.onCommitFiberRoot
    hook.onCommitFiberRoot = function (id: any, root: any, ...rest: any[]) {
      try {
        const p = (window as any)[KEY]
        p.commits++
        const seen = new Set()
        const walk = (f: any) => {
          if (!f || seen.has(f)) return
          seen.add(f)
          if (f.actualDuration > 0) {
            p.sawDur = true
            const t = f.type
            let n: string | null = null
            if (typeof t === 'function') n = t.displayName || t.name
            else if (t && typeof t === 'object')
              n =
                t.displayName ||
                (t.type && (t.type.displayName || t.type.name)) ||
                (t.render && (t.render.displayName || t.render.name))
            if (n) p.counts[n] = (p.counts[n] || 0) + 1
          }
          walk(f.child)
          walk(f.sibling)
        }
        walk(root.current)
      } catch {}
      return orig && orig.apply(this, [id, root, ...rest])
    }
    hook.__perfWrapped = true
    return true
  }
  if (!wrap()) {
    const iv = setInterval(() => {
      if (wrap()) clearInterval(iv)
    }, 5)
    setTimeout(() => clearInterval(iv), 8000)
  }
  ;(window as any).__perfReset = () => {
    const p = (window as any)[KEY]
    p.counts = {}
    p.commits = 0
  }
}

export type RenderReport = {
  commits: number
  sawDur: boolean
  counts: Record<string, number>
}

export const resetRender = (page: Page) => page.evaluate(() => (window as any).__perfReset?.())
export const readRender = (page: Page) =>
  page.evaluate(() => (window as any).__perf as RenderReport)

// ── Page-perf collector (prod project) ───────────────────────────────────────
// Native PerformanceObservers — no web-vitals dependency. LCP, CLS, long tasks,
// and Long Animation Frames (LoAF, the modern jank/INP-root-cause signal).
export function pagePerfInit() {
  const s: any = {
    lcp: 0,
    cls: 0,
    longTasks: { count: 0, total: 0, max: 0 },
    loaf: { count: 0, total: 0, maxBlocking: 0 },
  }
  ;(window as any).__pp = s
  const obs = (type: string, cb: (e: any) => void) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({
        type,
        buffered: true,
      } as any)
    } catch {}
  }
  obs('largest-contentful-paint', (e) => {
    s.lcp = e.renderTime || e.loadTime || e.startTime
  })
  obs('layout-shift', (e) => {
    if (!e.hadRecentInput) s.cls += e.value
  })
  obs('longtask', (e) => {
    s.longTasks.count++
    s.longTasks.total += e.duration
    s.longTasks.max = Math.max(s.longTasks.max, e.duration)
  })
  obs('long-animation-frame', (e) => {
    s.loaf.count++
    s.loaf.total += e.duration
    s.loaf.maxBlocking = Math.max(s.loaf.maxBlocking, e.blockingDuration || 0)
  })
}

// Read navigation timing + resource transfer sizes (same-origin, so
// encodedBodySize is populated) plus the accumulated observer state.
export async function readPagePerf(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const paint = performance.getEntriesByType('paint')
    const fcp = paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    let js = 0,
      css = 0,
      total = 0
    for (const r of res) {
      const sz = r.encodedBodySize || r.transferSize || 0
      total += sz
      if (r.initiatorType === 'script' || /\.m?js($|\?)/.test(r.name)) js += sz
      else if (/\.css($|\?)/.test(r.name)) css += sz
    }
    const kb = (b: number) => +(b / 1024).toFixed(1)
    return {
      ttfb: nav ? Math.round(nav.responseStart) : 0,
      fcp: Math.round(fcp),
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      load: nav ? Math.round(nav.loadEventEnd) : 0,
      transferKB: { js: kb(js), css: kb(css), total: kb(total) },
      ...(window as any).__pp,
      lcp: Math.round((window as any).__pp.lcp),
    }
  })
}

// ── Interaction driver ───────────────────────────────────────────────────────
// Click each timeframe in sequence (the candle/area morph path). Stable across
// dev/prod because the buttons render server-side regardless of chart data.
export async function switchTimeframes(page: Page, sequence: string[], settleMs = 450) {
  for (const tf of sequence) {
    const btn = page.getByRole('tab', { name: tf, exact: true }).first()
    if (await btn.count()) {
      await btn.click({ force: true }).catch(() => {})
      await page.waitForTimeout(settleMs)
    }
  }
}

// ── Report sink ──────────────────────────────────────────────────────────────
// One JSON file per test (no cross-worker write races) + a console table so a
// bare `bun run test:perf` is readable without opening the HTML report.
export function writeReport(name: string, data: unknown) {
  const dir = join(process.cwd(), 'perf', '.report')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2))
}

export function logTable(title: string, rows: Record<string, unknown>) {
  const lines = [`\n  ── ${title} ──`]
  for (const [k, v] of Object.entries(rows)) lines.push(`   ${k.padEnd(24)} ${v}`)
  console.log(lines.join('\n'))
}
