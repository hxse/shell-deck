import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertValidPublicId } from '../identifier'
import { normalizeWorkspaceUiLayout, type WorkspaceUiLayout } from './uiLayoutTypes'

export class UiLayoutStore {
  readonly rootDir: string

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {
    this.rootDir = rootDir
  }

  read(configId: string): WorkspaceUiLayout {
    const path = this.layoutPath(configId)
    if (!existsSync(path)) return normalizeWorkspaceUiLayout(undefined)
    return normalizeWorkspaceUiLayout(JSON.parse(readFileSync(path, 'utf8')))
  }

  save(configId: string, value: unknown): WorkspaceUiLayout {
    const normalizedConfigId = assertValidPublicId(configId, 'configId')
    const layout = normalizeWorkspaceUiLayout(value)
    mkdirSync(this.configDir(normalizedConfigId), { recursive: true })
    const path = this.layoutPath(normalizedConfigId)
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(layout, null, 2) + '\n')
    renameSync(tmpPath, path)
    return layout
  }

  private configDir(configId: string): string {
    return join(this.rootDir, '.shell-deck', 'configs', assertValidPublicId(configId, 'configId'))
  }

  private layoutPath(configId: string): string {
    return join(this.configDir(configId), 'ui-layout.json')
  }
}
