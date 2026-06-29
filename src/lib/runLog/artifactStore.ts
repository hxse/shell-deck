import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import shortUuid from 'short-uuid'
import { assertArtifactRef, assertContainedPath, assertNoSymlinkEscape } from './identifier'
import { RunStoragePaths } from './runStoragePaths'
import type { ArtifactRecord } from './runEventTypes'

const translator = shortUuid()
const SAFE_PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/

export class ArtifactStore {
  readonly paths: RunStoragePaths

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {
    this.paths = new RunStoragePaths(rootDir)
  }

  writeText(configId: string, runId: string, prefix: string, content: string, extension = 'txt'): ArtifactRecord {
    const safePrefix = SAFE_PREFIX_RE.test(prefix) ? prefix : 'artifact'
    const safeExt = /^[A-Za-z0-9]{1,8}$/.test(extension) ? extension : 'txt'
    this.paths.ensureRunDir(configId, runId)
    const createdAt = new Date().toISOString()
    const artifactRef = 'artifacts/' + safePrefix + '-' + translator.new() + '.' + safeExt
    const finalPath = this.pathForRef(configId, runId, artifactRef)
    const tmpPath = finalPath + '.tmp-' + translator.new()
    const fd = openSync(tmpPath, 'wx')
    try {
      const buffer = Buffer.from(content, 'utf8')
      writeSync(fd, buffer, 0, buffer.length)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmpPath, finalPath)
    const dirFd = openSync(this.paths.artifactsDir(configId, runId), 'r')
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    return { artifactRef, sizeBytes: statSync(finalPath).size, createdAt }
  }

  readText(configId: string, runId: string, artifactRef: string): string {
    return readFileSync(this.pathForRef(configId, runId, artifactRef), 'utf8')
  }

  exists(configId: string, runId: string, artifactRef: string): boolean {
    return existsSync(this.pathForRef(configId, runId, artifactRef))
  }

  listRefs(configId: string, runId: string): string[] {
    const root = this.paths.artifactsDir(configId, runId)
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => 'artifacts/' + entry.name)
      .sort()
  }

  pathForRef(configId: string, runId: string, artifactRef: string): string {
    const ref = assertArtifactRef(artifactRef)
    const root = this.paths.artifactsDir(configId, runId)
    mkdirSync(root, { recursive: true })
    const candidate = join(this.paths.runDir(configId, runId), ref)
    const contained = assertContainedPath(root, candidate)
    assertNoSymlinkEscape(root, contained)
    return contained
  }

  deleteForTest(configId: string, runId: string, artifactRef: string): void {
    const path = this.pathForRef(configId, runId, artifactRef)
    if (existsSync(path)) unlinkSync(path)
  }
}
