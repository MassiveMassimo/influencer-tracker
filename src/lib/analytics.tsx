import { useEffect } from 'react'

// PostHog project token is public (ships to the client) — safe as a VITE_ build-time var.
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined

// Dynamic-import after mount so the ~68KB gzip SDK never lands in the initial route
// bundle (the app lazy-loads charts for the same reason). history_change still records
// the first pageview at init time. Session replay loads its own lazy rrweb chunk and is
// gated by the PostHog project-settings toggle — config here only sets masking.
// Renders nothing — mount once near the root to fire the client-side init.
export function Analytics() {
  useEffect(() => {
    if (!KEY) return
    import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(KEY, {
          // Reverse proxy: ingest + assets ride our own origin (/relay/**, rewritten
          // to *.i.posthog.com by nitro routeRules in vite.config.ts) so blockers can't
          // drop events. ui_host keeps in-app links (toolbar, "view in PostHog") pointed
          // at the real US app.
          api_host: '/relay',
          ui_host: 'https://us.posthog.com',
          // defaults snapshot: history_change pageviews (fire on TanStack Router navs),
          // pageleave, and head-injected external scripts (SSR-safe replay recorder).
          defaults: '2026-01-30',
          autocapture: true,
          // Surveys unused — stop posthog-js fetching surveys.js (~31KB) on every route.
          disable_surveys: true,
          // NOTE: site has no text inputs today; revisit masking if any are added.
          session_recording: { maskAllInputs: false, maskInputOptions: { password: true } },
        })
      })
      .catch(() => {}) // adblockers can block the posthog chunk; fail silently
  }, [])
  return null
}
