import { spawnSync } from "node:child_process"

const runOnline = process.env.SHELL_DECK_RUN_ONLINE === "1"

if (!runOnline) {
  console.log("blocked: .010 Codex GUI smoke is online-only. Set SHELL_DECK_RUN_ONLINE=1 to run the real Playwright Codex-in-shell harness.")
  process.exit(0)
}

const codexCheck = spawnSync("bash", ["-lc", "command -v codex >/dev/null 2>&1"], { stdio: "ignore" })
if (codexCheck.status !== 0) {
  console.log("blocked: codex CLI is not available on PATH.")
  process.exit(0)
}

const result = spawnSync("bun", ["run", "scripts/runPlaywright.ts", "--workers=1", "tests/e2e/codexGuiOnline.spec.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SHELL_DECK_RUN_ONLINE: "1",
    SHELL_DECK_E2E_AI_JSON_PARSER: process.env.SHELL_DECK_E2E_AI_JSON_PARSER ?? "mock",
  },
})

process.exit(result.status ?? 1)
