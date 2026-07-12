import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const backendOrigin = process.env.SHELL_DECK_DEV_BACKEND_ORIGIN ?? 'http://127.0.0.1:5177'
const devHost = process.env.SHELL_DECK_DEV_HOST ?? '127.0.0.1'

export default defineConfig({
  plugins: [svelte()],
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
