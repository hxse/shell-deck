import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { assertListenMode, serverHostAllowlist } from './server/accessControl'
import { injectThemeBootstrap } from './src/lib/themeBootstrap'

const backendOrigin = process.env.SHELL_DECK_DEV_BACKEND_ORIGIN ?? 'http://127.0.0.1:5177'
const devHost = process.env.SHELL_DECK_DEV_HOST ?? '127.0.0.1'
const listenMode = process.env.SHELL_DECK_DEV_LISTEN_MODE

export default defineConfig({
  clearScreen: false,
  plugins: [themeHeadBootstrap(), devAssetAdmission(), roomRouteBridge(), tailwindcss(), svelte()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@xterm/xterm/')) return 'xterm'
          if (id.includes('/node_modules/svelte/')) return 'svelte'
          if (id.includes('/node_modules/short-uuid/')) return 'short-uuid'
        },
      },
    },
  },
  server: {
    host: devHost,
    allowedHosts: listenMode ? serverHostAllowlist(assertListenMode(listenMode)) : undefined,
    port: 5173,
    strictPort: true,
    // The application WebSocket connects directly to Bun in dev because Vite's
    // Node-compatible WebSocket proxy cannot forward upgrades under the Bun runtime.
    proxy: {
      '/api': {
        target: backendOrigin,
      },
      '/login': {
        target: backendOrigin,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
  },
})

function themeHeadBootstrap() {
  return {
    name: 'shell-deck-theme-head-bootstrap',
    enforce: 'pre' as const,
    transformIndexHtml: injectThemeBootstrap,
  }
}

type DevRequest = { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }
type DevResponse = { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }
type DevServer = { middlewares: { use(handler: (req: DevRequest, res: DevResponse, next: () => void) => void): void } }

function devAssetAdmission() {
  return {
    name: 'shell-deck-dev-asset-admission',
    configureServer(server: DevServer) { server.middlewares.use((req, res, next) => {
      if (!req.url) { next(); return }
      const pathname = new URL(req.url, 'http://vite.local').pathname
      if (isPageRoute(pathname) || pathname === '/login' || pathname.startsWith('/api')) { next(); return }
      void fetch(backendOrigin + '/health', { redirect: 'manual', headers: browserHeaders(req) }).then(async (response) => {
        if (response.status === 200) { next(); return }
        res.statusCode = response.status === 403 ? 403 : 401
        res.setHeader('cache-control', 'no-store')
        res.end(await response.text())
      }).catch(() => { res.statusCode = 502; res.end('shell_deck_backend_unavailable') })
    }) },
  }
}

function roomRouteBridge() {
  return {
    name: 'shell-deck-room-route-bridge',
    configureServer(server: DevServer) { server.middlewares.use((req, res, next) => {
      if (req.method !== 'GET' || !req.url) { next(); return }
      const pathname = new URL(req.url, 'http://vite.local').pathname
      if (!isPageRoute(pathname)) { next(); return }
      void fetch(backendOrigin + req.url, { redirect: 'manual', headers: browserHeaders(req) }).then(async (response) => {
        if (response.status === 200) { next(); return }
        res.statusCode = response.status
        for (const name of ['location', 'content-type']) {
          const value = response.headers.get(name)
          if (value) res.setHeader(name, value)
        }
        res.setHeader('cache-control', 'no-store')
        res.end(await response.text())
      }).catch(() => { res.statusCode = 502; res.end('shell_deck_backend_unavailable') })
    }) },
  }
}

function isPageRoute(pathname: string): boolean {
  return pathname === '/' || (/^\/[^/]+$/.test(pathname) && !['/favicon.ico', '/login', '/api', '/ws'].includes(pathname))
}

function browserHeaders(req: DevRequest): Headers {
  const headers = new Headers()
  for (const name of ['accept', 'cookie', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'])
    if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name] as string)
  const target = new URL(backendOrigin)
  if (typeof req.headers.host === 'string') target.hostname = new URL('http://' + req.headers.host).hostname
  headers.set('host', target.host)
  return headers
}
