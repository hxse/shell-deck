import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'

const CONFIG_ID = 'codex-tui-delivery-029'
const TERMINAL_ID = 'term_codex_tui_029'
const RETURNED_PREFIX = '__SD_CODEX_TUI_RETURNED_'

test('real Codex TUI accepts Auto-resolved bracketed /quit plus CR from Macro runner', async () => {
  const version = codexVersionOrThrow()
  console.info('[codex-tui-delivery] ' + version)

  const root = mkdtempSync(join(tmpdir(), 'shell-deck-codex-tui-delivery-'))
  const codexHome = join(root, 'codex-home')
  const workspace = join(root, 'workspace')
  mkdirSync(codexHome, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(codexHome, 'config.toml'), codexConfig(workspace))

  const manager = new TerminalDeckManager({ replayByteLimit: 2 * 1024 * 1024 })
  manager.setTerminalEnvProvider(() => ({
    CODEX_HOME: codexHome,
    OPENAI_API_KEY: 'sk-shell-deck-rejected-loopback',
    OPENAI_BASE_URL: 'http://127.0.0.1:1/v1',
    SHELL_DECK_DISABLE_HOOKS: '1',
  }))
  const messages: ServerMessage[] = []
  manager.connectClient(CONFIG_ID, (message) => messages.push(message), 'codex-tui-delivery-client')

  let terminalCreated = false
  try {
    manager.createTerminal(CONFIG_ID, { backend: 'real', terminalId: TERMINAL_ID, terminalAlias: 'codex_1', cols: 120, rows: 40 })
    terminalCreated = true
    await waitFor(() => shellPromptVisible(outputText(messages)), 10_000, 'initial Bash prompt', messages)

    const launch = [
      'cd ' + shellQuote(workspace),
      'codex --no-alt-screen -c disable_paste_burst=false',
      'status=$?',
      `printf '\\n${RETURNED_PREFIX}%s__\\n' "$status"`,
    ].join('; ')
    manager.input(CONFIG_ID, { kind: 'id', value: TERMINAL_ID }, launch + '\r')
    await waitFor(() => stripAnsi(outputText(messages)).includes('OpenAI Codex'), 20_000, 'Codex TUI ready', messages)

    const runStore = new RunEventStore(root)
    const templateStore = new MacroTemplateStore(root)
    const service = new MacroRunnerService(manager, templateStore, runStore, new AgentEventStore(root))
    templateStore.save(CONFIG_ID, template(), manager.indexMap(CONFIG_ID))
    await service.start(CONFIG_ID, { templateId: 'codex_tui_delivery_029' })
    await waitFor(() => service.snapshot(CONFIG_ID).status === 'completed', 10_000, 'Macro run completion', messages)

    const snapshot = service.snapshot(CONFIG_ID)
    const sent = snapshot.run?.replay.events.find((event) => event.kind === 'terminal_text_sent' && event.stepId === 'send_codex_quit')
    expect(sent?.data.delivery).toBe('auto')
    expect(sent?.data.resolvedDelivery).toBe('bracketed-paste')
    expect(sent?.data.ending).toBe('cr')
    const content = runStore.readArtifact(CONFIG_ID, String(snapshot.runId), artifactRef(sent, 'content'))
    const write = runStore.readArtifact(CONFIG_ID, String(snapshot.runId), artifactRef(sent, 'write'))
    expect(content).toBe('/quit')
    expect(write).toBe('\u001b[200~/quit\u001b[201~\r')

    await waitFor(() => {
      const visible = stripAnsi(outputText(messages))
      const returnedAt = visible.lastIndexOf(RETURNED_PREFIX + '0__')
      return visible.includes('Shutting down...') && returnedAt >= 0 && /\][#$] /.test(visible.slice(returnedAt))
    }, 20_000, 'Codex /quit shutdown and Bash prompt return', messages)
  } finally {
    if (terminalCreated) manager.closeTerminal(CONFIG_ID, { kind: 'id', value: TERMINAL_ID })
    await Bun.sleep(300)
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)

function template(): MacroTemplate {
  const now = '2026-07-12T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'codex_tui_delivery_029',
    name: 'Codex TUI delivery 029',
    description: 'local slash-command smoke; no model request',
    configId: CONFIG_ID,
    body: [{
      id: 'send_codex_quit',
      type: 'send',
      terminal: { kind: 'id', value: TERMINAL_ID },
      message: { parts: [{ kind: 'text', text: '/quit' }] },
      delivery: 'auto',
      ending: 'cr',
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function codexVersionOrThrow(): string {
  try {
    const version = execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim()
    if (!/^codex-cli\s+\S+/.test(version)) throw new Error('unexpected version output: ' + version)
    return version
  } catch (error) {
    throw new Error('codex_tui_gate_blocked:codex_cli_unavailable:' + (error instanceof Error ? error.message : String(error)))
  }
}

function codexConfig(workspace: string): string {
  return [
    'model = "gpt-5.1-codex-mini"',
    'model_provider = "rejected_loopback"',
    'disable_paste_burst = false',
    'check_for_update_on_startup = false',
    '',
    '[model_providers.rejected_loopback]',
    'name = "Rejected loopback"',
    'base_url = "http://127.0.0.1:1/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
    '[projects.' + JSON.stringify(workspace) + ']',
    'trust_level = "trusted"',
    '',
  ].join('\n')
}

function artifactRef(event: { data: Record<string, unknown> } | undefined, key: 'content' | 'write'): string {
  const value = event?.data[key]
  if (!value || typeof value !== 'object' || !('artifactRef' in value)) return ''
  return String((value as { artifactRef: unknown }).artifactRef)
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string, messages: ServerMessage[]): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(25)
  }
  const tail = stripAnsi(outputText(messages)).slice(-4000)
  throw new Error('timeout waiting for ' + label + '\n--- terminal tail ---\n' + tail)
}

function outputText(messages: ServerMessage[]): string {
  return messages
    .filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === TERMINAL_ID)
    .map((message) => message.data)
    .join('')
}

function shellPromptVisible(text: string): boolean {
  return /\][#$] /.test(stripAnsi(text))
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '')
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
