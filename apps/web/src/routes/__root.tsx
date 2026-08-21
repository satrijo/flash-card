/*
 * DESIGN READ: Systems Architecture — Neuform Featured, Meng To
 * Dark nav, lime primary, purple secondary, JetBrains Mono labels.
 *
 * DIALS: DESIGN_VARIANCE=8, MOTION_INTENSITY=6, VISUAL_DENSITY=7
 * NAV: Single line, ≤80px, dark surface bg with bottom border
 */

import { HeadContent, Link, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useSyncWorker } from '../hooks/useSyncWorker'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Flashcard SRS',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@600&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useSyncWorker()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-[#050505] text-white min-h-[100dvh]">
        {/* Ambient effect layer (WebGL stand-in) */}
        <div className="effect-glow" aria-hidden="true" />

        {/* Nav - single line, ≤80px, dark surface */}
        <nav className="sticky top-0 z-40 bg-[#050505]/80 backdrop-blur-md border-b border-[#4C4C4C]">
          <div className="relative z-10 max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <Link
              to="/"
              className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#C7F300] hover:text-[#d4f733] transition-colors"
            >
              Flashcard
            </Link>
            <div className="flex items-center gap-6">
              <Link
                to="/"
                className={`font-mono text-[12px] font-semibold uppercase tracking-wide transition-colors ${
                  currentPath === '/'
                    ? 'text-[#C7F300]'
                    : 'text-[#A1A1AA] hover:text-white'
                }`}
              >
                Cards
              </Link>
              {/* Primary CTA — lime: single review intent (no duplicate "Review" link) */}
              <Link
                to="/review"
                search={{ category: undefined }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn"
              >
                Start Review
              </Link>
            </div>
          </div>
        </nav>

        <main className="relative z-10 max-w-6xl mx-auto px-6">
          {children}
        </main>

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
