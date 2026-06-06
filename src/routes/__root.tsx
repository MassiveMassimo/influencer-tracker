import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { WorkspaceRail } from '../components/WorkspaceRail'
import { MobileNav } from '../components/MobileNav'
import { listCreators } from '../lib/data'
import { PreferencesProvider } from '#/lib/preferences.tsx'
import { HapticsProvider } from '#/lib/haptics.tsx'
import { siteUrl } from '#/og/site.ts'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => listCreators(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Signal Tracker — influencer accuracy vs SPY' },
      {
        name: 'description',
        content:
          'Forward returns of finfluencer stock calls, measured from post date and net of SPY.',
      },
      { name: 'theme-color', content: '#173a40' },
      { property: 'og:site_name', content: 'Signal Tracker' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Signal Tracker — influencer accuracy vs SPY' },
      { property: 'og:description', content: 'Forward returns of stock calls, net of SPY.' },
      { property: 'og:url', content: siteUrl('/') },
      { property: 'og:image', content: siteUrl('/og.png') },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Signal Tracker' },
      { name: 'twitter:description', content: 'Forward returns of stock calls, net of SPY.' },
      { name: 'twitter:image', content: siteUrl('/og.png') },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  const creators = Route.useLoaderData()
  return (
    <PreferencesProvider>
      <HapticsProvider>
        <div
          data-vaul-drawer-wrapper=""
          className="grid min-h-svh grid-cols-1 bg-background text-foreground md:grid-cols-[260px_1fr]"
        >
          <div className="sticky top-0 hidden h-svh self-start md:block">
            <WorkspaceRail creators={creators} />
          </div>
          <div className="min-w-0">
            <MobileNav creators={creators} />
            <Outlet />
          </div>
        </div>
      </HapticsProvider>
    </PreferencesProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-mono antialiased [overflow-wrap:anywhere]">
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
