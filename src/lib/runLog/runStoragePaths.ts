import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { assertValidPublicId } from '../identifier'
import { assertContainedPath, assertRunId } from './identifier'

export class RunStoragePaths {
  readonly rootDir: string

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {
    this.rootDir = rootDir
  }

  configDir(configId: string): string {
    return join(this.rootDir, '.shell-deck', 'configs', assertValidPublicId(configId, 'configId'))
  }

  runsDir(configId: string): string {
    return join(this.configDir(configId), 'runs')
  }

  runDir(configId: string, runId: string): string {
    const dir = join(this.runsDir(configId), assertRunId(runId))
    return assertContainedPath(this.runsDir(configId), dir)
  }

  eventsPath(configId: string, runId: string): string {
    return join(this.runDir(configId, runId), 'events.jsonl')
  }

  artifactsDir(configId: string, runId: string): string {
    return join(this.runDir(configId, runId), 'artifacts')
  }

  ensureRunDir(configId: string, runId: string): void {
    mkdirSync(this.artifactsDir(configId, runId), { recursive: true })
  }
}
