import { unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import {
  assertPrivateNotificationFile,
  fsyncDirectory,
  initializeUserDataRoot,
  pathEntryExists,
  readPrivateFile,
  type UserDataPaths,
  withFileLockSync,
  writePrivateFileAtomic,
} from './userDataRoot'

export type NotificationConfigLocation = {
  paths: UserDataPaths
  targetPath: string
  legacyPath: string
  state: 'missing' | 'target' | 'relocated' | 'identical-cleanup'
}

export function relocateNotificationConfig(options: {
  env?: NodeJS.ProcessEnv
  cwd?: string
  root?: string
} = {}): NotificationConfigLocation {
  const env = options.env ?? process.env
  const cwd = resolve(options.cwd ?? process.cwd())
  const paths = initializeUserDataRoot(options.root)
  const legacyBase = env.SHELL_DECK_DATA_ROOT?.trim() || cwd
  const legacyPath = resolve(legacyBase, '.shell-deck', 'notification-profiles.json')
  const targetPath = paths.notificationProfiles
  if (legacyPath === targetPath) {
    const targetExists = pathEntryExists(targetPath)
    if (targetExists) assertPrivateNotificationFile(targetPath)
    return { paths, targetPath, legacyPath, state: targetExists ? 'target' : 'missing' }
  }
  const digest = createHash('sha256').update(targetPath).digest('hex')
  const lockPath = join(paths.locks, 'notification-relocation-' + digest + '.lock')

  return withFileLockSync(lockPath, () => {
    const legacyExists = pathEntryExists(legacyPath)
    const targetExists = pathEntryExists(targetPath)
    if (legacyExists) assertPrivateNotificationFile(legacyPath)
    if (targetExists) assertPrivateNotificationFile(targetPath)

    if (!legacyExists && !targetExists) return { paths, targetPath, legacyPath, state: 'missing' }
    if (!legacyExists) return { paths, targetPath, legacyPath, state: 'target' }

    const legacyBytes = readPrivateFile(legacyPath)
    if (!targetExists) {
      writePrivateFileAtomic(targetPath, legacyBytes)
      if (!readPrivateFile(targetPath).equals(legacyBytes)) throw new Error('notification_config_relocation_verification_failed')
      unlinkSync(legacyPath)
      fsyncDirectory(dirname(legacyPath))
      return { paths, targetPath, legacyPath, state: 'relocated' }
    }

    const targetBytes = readPrivateFile(targetPath)
    if (!targetBytes.equals(legacyBytes)) throw new Error('notification_config_path_conflict')
    unlinkSync(legacyPath)
    fsyncDirectory(dirname(legacyPath))
    return { paths, targetPath, legacyPath, state: 'identical-cleanup' }
  })
}
