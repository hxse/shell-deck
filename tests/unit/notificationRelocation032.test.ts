import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { relocateNotificationConfig } from '../../server/notificationConfigRelocation'
import { initializeUserDataRoot, writePrivateFileAtomic } from '../../server/userDataRoot'

test('notification relocation preserves raw bytes and deletes only an identical legacy source', () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-notif-'))
  try {
    const cwd = join(base, 'cwd')
    const targetRoot = join(base, 'user-data')
    const legacy = join(cwd, '.shell-deck', 'notification-profiles.json')
    mkdirSync(dirname(legacy), { recursive: true, mode: 0o700 })
    const bytes = Buffer.from('{\n  "telegram": {"token": "keep-bytes"}\n}\n')
    writeFileSync(legacy, bytes, { mode: 0o600 })
    chmodSync(legacy, 0o600)
    const result = relocateNotificationConfig({ env: { HOME: base }, cwd, root: targetRoot })
    expect(result.state).toBe('relocated')
    expect(readFileSync(result.targetPath)).toEqual(bytes)
    expect(existsSync(legacy)).toBe(false)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('different notification target and legacy content fails without overwriting either file', () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-notif-conflict-'))
  try {
    const cwd = join(base, 'cwd')
    const paths = initializeUserDataRoot(join(base, 'target'))
    const legacy = join(cwd, '.shell-deck', 'notification-profiles.json')
    mkdirSync(dirname(legacy), { recursive: true, mode: 0o700 })
    writeFileSync(legacy, 'legacy', { mode: 0o600 })
    chmodSync(legacy, 0o600)
    writePrivateFileAtomic(paths.notificationProfiles, 'target')
    expect(() => relocateNotificationConfig({ env: { HOME: base }, cwd, root: paths.root })).toThrow('notification_config_path_conflict')
    expect(readFileSync(legacy, 'utf8')).toBe('legacy')
    expect(readFileSync(paths.notificationProfiles, 'utf8')).toBe('target')
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('an explicit root equal to the legacy directory never deletes its own target', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'shell-deck-032-notification-same-path-'))
  try {
    const root = join(cwd, '.shell-deck')
    mkdirSync(root, { recursive: true })
    const target = join(root, 'notification-profiles.json')
    writeFileSync(target, 'same-path', { mode: 0o600 })
    const result = relocateNotificationConfig({ root, cwd, env: {} })
    expect(result).toMatchObject({ state: 'target', targetPath: target, legacyPath: target })
    expect(readFileSync(target, 'utf8')).toBe('same-path')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
