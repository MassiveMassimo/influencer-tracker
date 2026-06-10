import { useEffect } from 'react'

// PostHog project token is public (ships to the client) — safe as a VITE_ build-time var.
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com'

// Dynamic-import after mount so the ~68KB gzip SDK never lands in the initial route
// bundle (the app lazy-loads charts for the same reason). history_change still records
// the first pageview at init time. Session replay loads its own lazy rrweb chunk and is
// gated by the PostHog project-settings toggle — config here only sets masking.
export function Analytics({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return
    import('posthog-js').then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        capture_pageview: 'history_change',
        capture_pageleave: 'if_capture_pageview',
        autocapture: true,
        session_recording: {
          maskAllInputs: false,
          maskInputOptions: { password: true },
        },
      })
    })
  }, [])
  return <>{children}</>
}
