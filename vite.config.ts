import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const backendOrigin = process.env.SHELL_DECK_DEV_BACKEND_ORIGIN ?? 'http://127.0.0.1:5177'
const devHost = process.env.SHELL_DECK_DEV_HOST ?? '127.0.0.1'

export default defineConfig({
  plugins: [roomRouteBridge(), svelte()],
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
    port: 5173,
    strictPort: true,
    // The application WebSocket connects directly to Bun in dev because Vite's
    // Node-compatible WebSocket proxy cannot forward upgrades under the Bun runtime.
    proxy: {
      '/api': {
        target: backendOrigin,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
  },
})

function roomRouteBridge() {
  return {
    name: 'shell-deck-room-route-bridge',
    configureServer(server: { middlewares: { use(handler: (req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }, res: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }, next: () => void) => void): void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || !req.url) { next(); return }
        const pathname = new URL(req.url, 'http://vite.local').pathname
        const directRoute = /^\/[^/]+$/.test(pathname) && pathname !== '/favicon.ico'
        if (pathname !== '/' && !directRoute) { next(); return }
        void fetch(backendOrigin + pathname, { redirect: 'manual', headers: { accept: 'text/html' } }).then(async (response) => {
          if (response.status === 200) { next(); return }
          res.statusCode = response.status
          const location = response.headers.get('location')
          const contentType = response.headers.get('content-type')
          if (location) res.setHeader('location', location)
          if (contentType) res.setHeader('content-type', contentType)
          res.setHeader('cache-control', 'no-store')
          res.end(await response.text())
        }).catch(() => {
          res.statusCode = 502
          res.end('shell_deck_backend_unavailable')
        })
      })
    },
  }
}
