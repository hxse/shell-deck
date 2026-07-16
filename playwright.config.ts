import { defineConfig, devices } from 'playwright/test'

const host = process.env.SHELL_DECK_E2E_HOST ?? '127.0.0.1'
const port = process.env.SHELL_DECK_E2E_PORT ?? '5177'
const baseURL = `http://${host}:${port}`
const aiJsonParser = process.env.SHELL_DECK_E2E_AI_JSON_PARSER ?? 'disabled'
const seedBackend = process.env.SHELL_DECK_E2E_SEED === 'none'
  ? ''
  : ` --seed-backend ${process.env.SHELL_DECK_E2E_SEED ?? 'fake'}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bun run build && bun run server/httpServer.ts --host ${host} --port ${port}${seedBackend} --ai-json-parser ${aiJsonParser}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
