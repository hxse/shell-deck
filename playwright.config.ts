import { defineConfig, devices } from 'playwright/test'

const host = process.env.SHELL_DECK_E2E_HOST ?? '127.0.0.1'
const port = process.env.SHELL_DECK_E2E_PORT ?? '5177'
const baseURL = `http://${host}:${port}`
const browserLibraryPath = process.env.SHELL_DECK_PLAYWRIGHT_LD_LIBRARY_PATH
const webServerEnvironment: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) webServerEnvironment[key] = value
}
webServerEnvironment.HISTFILE = '/dev/null'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(browserLibraryPath ? { launchOptions: { env: { ...process.env, LD_LIBRARY_PATH: browserLibraryPath } } } : {}),
  },
  webServer: {
    command: `bun run build && bun run server/httpServer.ts --access-mode guest --listen-mode local --port ${port}`,
    env: webServerEnvironment,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
