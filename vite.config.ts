import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { assertListenMode, serverHostAllowlist } from './server/accessControl'
import { LOGIN_QR_ASSET_PATH, LOGIN_STYLE_ASSET_PATH } from './src/lib/loginToken'
import { injectThemeBootstrap } from './src/lib/themeBootstrap'

const backendOrigin = process.env.SHELL_DECK_DEV_BACKEND_ORIGIN ?? 'http://127.0.0.1:5177'
const devHost = process.env.SHELL_DECK_DEV_HOST ?? '127.0.0.1'
const listenMode = process.env.SHELL_DECK_DEV_LISTEN_MODE

export default defineConfig({
  clearScreen: false,
  plugins: [
    themeHeadBootstrap(),
    devAssetAdmission(),
    loginQrDevAsset(),
    loginStyleDevAsset(),
    roomRouteBridge(),
    tailwindcss(),
    svelte(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: resolve(process.cwd(), 'index.html'),
        'login-qr': resolve(process.cwd(), 'src/loginQrClient.ts'),
      },
      output: {
        entryFileNames(chunk) {
          return chunk.name === 'login-qr' ? 'login-assets/login-qr.js' : 'assets/[name]-[hash].js'
        },
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
      const admissionPath = (pathname === LOGIN_QR_ASSET_PATH || pathname === LOGIN_STYLE_ASSET_PATH)
        ? '/login?next=%2F'
        : '/health'
      void fetch(backendOrigin + admissionPath, { redirect: 'manual', headers: browserHeaders(req) }).then(async (response) => {
        if (response.status === 200) { next(); return }
        res.statusCode = response.status === 403 ? 403 : 401
        res.setHeader('cache-control', 'no-store')
        res.end(await response.text())
      }).catch(() => { res.statusCode = 502; res.end('shell_deck_backend_unavailable') })
    }) },
  }
}

function loginQrDevAsset() {
  let bundledSource: Promise<string> | null = null
  return {
    name: 'shell-deck-login-qr-dev-asset',
    configureServer(server: DevServer) { server.middlewares.use((req, res, next) => {
      if (!req.url || new URL(req.url, 'http://vite.local').pathname !== LOGIN_QR_ASSET_PATH) {
        next()
        return
      }
      bundledSource ??= buildLoginQrDevBundle()
      void bundledSource.then((source) => {
        res.statusCode = 200
        res.setHeader('content-type', 'text/javascript; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(source)
      }).catch(() => {
        res.statusCode = 500
        res.end('shell_deck_login_qr_bundle_failed')
      })
    }) },
  }
}

function loginStyleDevAsset() {
  return {
    name: 'shell-deck-login-style-dev-asset',
    configureServer(server: DevServer) { server.middlewares.use((req, res, next) => {
      if (req.url && new URL(req.url, 'http://vite.local').pathname === LOGIN_STYLE_ASSET_PATH) {
        req.url = '/src/app.css'
        req.headers.accept = 'text/css,*/*;q=0.1'
        res.setHeader('cache-control', 'no-store')
      }
      next()
    }) },
  }
}

async function buildLoginQrDevBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [resolve(process.cwd(), 'src/loginQrClient.ts')],
    format: 'esm',
    target: 'browser',
  })
  if (!result.success || result.outputs.length !== 1) throw new Error('login_qr_dev_bundle_failed')
  return await result.outputs[0].text()
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
