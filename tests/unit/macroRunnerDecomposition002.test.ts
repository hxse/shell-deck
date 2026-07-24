import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { MacroRunnerService } from '../../server/macroRunnerService'

describe('Macro runner lifecycle decomposition', () => {
  test('public facade and internal modules keep one live registry and one runtime revision owner', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const names = [
      'macroRunnerService.ts',
      'macroRunnerLifecycle.ts',
      'macroRunnerInteraction.ts',
      'macroRunnerPublication.ts',
      'macroRunnerLiveState.ts',
      'macroRunnerArtifacts.ts',
      'macroStructuredCapture.ts',
    ] as const
    const sources = Object.fromEntries(names.map((name) => [
      name,
      readFileSync(resolve(serverRoot, name), 'utf8'),
    ])) as Record<(typeof names)[number], string>
    const combined = names.map((name) => sources[name]).join('\n')
    const productionFiles = readdirSync(serverRoot).filter((file) => file.endsWith('.ts'))

    expect(consumers(serverRoot, productionFiles, 'macroRunnerLifecycle')).toEqual(['macroRunnerService.ts'])
    expect(consumers(serverRoot, productionFiles, 'macroRunnerInteraction')).toEqual(['macroRunnerLifecycle.ts'])
    expect(consumers(serverRoot, productionFiles, 'macroRunnerPublication')).toEqual(['macroRunnerLifecycle.ts'])
    expect(consumers(serverRoot, productionFiles, 'macroRunnerLiveState')).toEqual([
      'macroRunnerArtifacts.ts',
      'macroRunnerInteraction.ts',
      'macroRunnerLifecycle.ts',
      'macroRunnerPublication.ts',
      'macroRunnerService.ts',
      'macroStructuredCapture.ts',
    ])
    for (const name of names.filter((name) => name !== 'macroRunnerService.ts')) {
      expect(sources[name]).not.toMatch(/from ['"]\.\/macroRunnerService['"]/)
    }

    expect(combined.match(/runs\s*=\s*new Map<string, LiveRun>/g)).toHaveLength(1)
    expect(combined.match(/runtimeRevisions\s*=\s*new Map<string, number>/g)).toHaveLength(1)
    expect(combined.match(/pendingInput:\s*PendingInput \| null/g)).toHaveLength(1)
    expect(combined.match(/pendingStructuredCapture:\s*PendingStructuredCapture \| null/g)).toHaveLength(1)
    expect(combined.match(/publishTimer:\s*ReturnType<typeof setTimeout> \| null/g)).toHaveLength(1)
    expect(sources['macroRunnerService.ts']).toContain('private readonly lifecycle: MacroRunnerLifecycle')
    for (const name of names) {
      expect(sources[name].trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('MacroRunnerService retains the existing public method surface', () => {
    for (const method of [
      'hasActiveRun',
      'snapshot',
      'traces',
      'preflightStart',
      'start',
      'pause',
      'resume',
      'stop',
      'submitStructuredJson',
      'updateInputDraft',
      'submitInput',
      'destroyRoom',
    ] as const) {
      expect(typeof MacroRunnerService.prototype[method]).toBe('function')
    }
  })

  test('bootstrap, input publication and terminalization source order stays explicit', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const lifecycle = readFileSync(resolve(serverRoot, 'macroRunnerLifecycle.ts'), 'utf8')
    const interaction = readFileSync(resolve(serverRoot, 'macroRunnerInteraction.ts'), 'utf8')
    const publication = readFileSync(resolve(serverRoot, 'macroRunnerPublication.ts'), 'utf8')
    const service = readFileSync(resolve(serverRoot, 'macroRunnerService.ts'), 'utf8')

    expectOrdered(lifecycle, [
      'this.manager.acquireRunStructureLock(ticket.roomId, runId)',
      'structureLocked = true',
      'ticket.assertAuthorized()',
      'this.runStore.publishManifest(manifest)',
      'ticket.assertAuthorized()',
      "this.runStore.append(runId, 'run_started'",
      'started = true',
      'ticket.assertAuthorized()',
      'const live = createLiveRun({',
      'this.runs.set(room.roomId, live)',
      'this.publication.publishSnapshot(live)',
      'queueMicrotask(() => void this.execute(live))',
    ])
    expectOrdered(interaction, [
      "this.ports.appendEvent(run, 'runner_input_submitted'",
      'pending.draft = value',
      'run.pendingInput = null',
      "pending.resolve({ kind: 'submitted', value })",
    ])
    expectOrdered(publication, [
      'const canSendDelta = run.publishedEventSeq >= snapshot.firstAvailableEventSeq - 1',
      "type: 'runner_snapshot'",
      "type: 'runner_delta'",
      'run.publishedEventSeq = snapshot.lastEventSeq',
    ])
    expect(service).toContain('async start(')
    expect(publication).toContain('}, 25)')
    expect(publication).toContain('run.publishTimer.unref?.()')
  })
})

function consumers(serverRoot: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"]\\./${moduleName}['"]`)
  return files
    .filter((file) => pattern.test(readFileSync(resolve(serverRoot, file), 'utf8')))
    .sort()
}

function expectOrdered(source: string, needles: string[]): void {
  let offset = 0
  for (const needle of needles) {
    const index = source.indexOf(needle, offset)
    expect(index, `${needle} must remain after the previous phase`).toBeGreaterThanOrEqual(offset)
    offset = index + needle.length
  }
}
