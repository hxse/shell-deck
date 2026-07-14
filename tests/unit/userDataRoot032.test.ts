import { expect, test } from 'bun:test'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertPrivateNotificationFile,
  initializeUserDataRoot,
  publishPrivateFileAtomic,
  publishPrivateFileDelete,
  resolveUserDataRoot,
  writePrivateFileAtomic,
} from '../../server/userDataRoot'

test('User Data Root resolution is independent from cwd and creates private paths', () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-root-'))
  try {
    expect(resolveUserDataRoot({ SHELL_DECK_DATA_ROOT: join(base, 'explicit') })).toBe(join(base, 'explicit'))
    expect(resolveUserDataRoot({ XDG_DATA_HOME: join(base, 'xdg'), HOME: join(base, 'home') })).toBe(join(base, 'xdg', 'shell-deck'))
    expect(resolveUserDataRoot({ HOME: join(base, 'home') })).toBe(join(base, 'home', '.local', 'share', 'shell-deck'))
    const paths = initializeUserDataRoot(join(base, 'data'))
    for (const path of [paths.root, paths.macros, paths.library, paths.runs, paths.agentEvents, paths.locks]) {
      expect(lstatSync(path).mode & 0o777).toBe(0o700)
    }
    const target = join(paths.macros, 'private.json')
    writePrivateFileAtomic(target, 'secret')
    expect(readFileSync(target, 'utf8')).toBe('secret')
    expect(lstatSync(target).mode & 0o777).toBe(0o600)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('broad existing roots warn while notification symlink and broad files fail closed', () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-perm-'))
  try {
    const root = join(base, 'data')
    const paths = initializeUserDataRoot(root)
    chmodSync(root, 0o755)
    const warnings: string[] = []
    initializeUserDataRoot(root, (warning) => warnings.push(warning.code))
    expect(warnings).toContain('user_data_permissions_too_open')
    writePrivateFileAtomic(paths.notificationProfiles, '{}')
    chmodSync(paths.notificationProfiles, 0o644)
    expect(() => assertPrivateNotificationFile(paths.notificationProfiles)).toThrow('notification_config_permissions_too_open')
    rmSync(paths.notificationProfiles)
    symlinkSync(join(base, 'missing'), paths.notificationProfiles)
    expect(() => assertPrivateNotificationFile(paths.notificationProfiles)).toThrow('notification_config_permissions_too_open')
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('startup audits existing non-notification content permissions without rewriting them', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-permission-audit-'))
  try {
    const paths = initializeUserDataRoot(root)
    const broad = join(paths.macros, 'manual.json')
    writeFileSync(broad, '{}', { mode: 0o644 })
    chmodSync(broad, 0o644)
    const warnings: Array<{ code: string; path: string }> = []
    initializeUserDataRoot(root, (warning) => warnings.push(warning))
    expect(warnings).toContainEqual({ code: 'user_data_permissions_too_open', path: broad })
    expect(lstatSync(broad).mode & 0o777).toBe(0o644)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('phase-aware file mutation reports post-publish durability failure without hiding authoritative truth', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-publish-receipt-'))
  try {
    const target = join(initializeUserDataRoot(root).macros, 'published.json')
    const replace = publishPrivateFileAtomic(target, 'published', {
      syncParentDirectory() { throw new Error('injected_directory_fsync_failure') },
    })
    expect(replace).toMatchObject({ published: true, durability: 'uncertain' })
    expect(readFileSync(target, 'utf8')).toBe('published')

    const remove = publishPrivateFileDelete(target, {
      syncParentDirectory() { throw new Error('injected_directory_fsync_failure') },
    })
    expect(remove).toMatchObject({ published: true, durability: 'uncertain' })
    expect(() => readFileSync(target)).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
