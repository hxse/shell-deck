import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Database } from 'bun:sqlite'
import { createGeneratedSuffix } from '../src/lib/generatedId'

export const PRIVATE_DIRECTORY_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600
export const USER_DATA_DIRECTORIES = ['macros', 'runs', 'agent-events', '.locks'] as const

export type UserDataPaths = {
  root: string
  macros: string
  notificationProfiles: string
  runs: string
  agentEvents: string
  locks: string
}

export type UserDataWarning = {
  code: 'user_data_permissions_too_open'
  path: string
}

export type PublishedFileMutationReceipt =
  | { published: true; durability: 'confirmed' }
  | { published: true; durability: 'uncertain'; postPublishError: unknown }

export type PublishedFileMutationOptions = {
  syncParentDirectory?: (path: string) => void
}

export function resolveUserDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SHELL_DECK_DATA_ROOT?.trim()
  if (explicit) return resolve(explicit)
  const xdg = env.XDG_DATA_HOME?.trim()
  if (xdg) return resolve(xdg, 'shell-deck')
  const home = env.HOME?.trim()
  if (!home) throw new Error('user_data_home_missing')
  return resolve(home, '.local', 'share', 'shell-deck')
}

export function userDataPaths(root = resolveUserDataRoot()): UserDataPaths {
  const normalizedRoot = resolve(root)
  return {
    root: normalizedRoot,
    macros: join(normalizedRoot, 'macros'),
    notificationProfiles: join(normalizedRoot, 'notification-profiles.json'),
    runs: join(normalizedRoot, 'runs'),
    agentEvents: join(normalizedRoot, 'agent-events'),
    locks: join(normalizedRoot, '.locks'),
  }
}

export function initializeUserDataRoot(
  root = resolveUserDataRoot(),
  onWarning: (warning: UserDataWarning) => void = () => {},
): UserDataPaths {
  const paths = userDataPaths(root)
  ensurePrivateDirectory(paths.root, onWarning)
  for (const name of USER_DATA_DIRECTORIES) {
    ensurePrivateDirectory(join(paths.root, name), onWarning)
  }
  for (const name of USER_DATA_DIRECTORIES) auditManagedTree(join(paths.root, name), onWarning)
  return paths
}

export function ensurePrivateDirectory(path: string, onWarning: (warning: UserDataWarning) => void = () => {}): void {
  const existing = lstatIfExists(path)
  if (!existing) {
    mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    chmodSync(path, PRIVATE_DIRECTORY_MODE)
    fsyncDirectory(dirname(path))
    return
  }
  const info = existing
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('user_data_path_not_directory:' + path)
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    onWarning({ code: 'user_data_permissions_too_open', path })
  }
}

export function assertManagedRegularFile(path: string, permissionError = 'user_data_file_invalid'): void {
  const info = lstatIfExists(path)
  if (!info) return
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(permissionError)
}

export function assertPrivateNotificationFile(path: string): void {
  const info = lstatIfExists(path)
  if (!info) return
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('notification_config_permissions_too_open')
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error('notification_config_permissions_too_open')
  }
}

export function assertContainedUserDataPath(root: string, candidate: string): string {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  const difference = relative(normalizedRoot, normalizedCandidate)
  if (difference === '' || (!difference.startsWith('..' + sep) && difference !== '..' && !isAbsolute(difference))) {
    return normalizedCandidate
  }
  throw new Error('user_data_path_escape')
}

export function canonicalResourceRelativePath(root: string, target: string): string {
  const contained = assertContainedUserDataPath(root, target)
  const value = relative(resolve(root), contained).split(sep).join('/')
  if (!value || value.startsWith('../')) throw new Error('invalid_content_resource_path')
  return value
}

export function resourceLockPath(paths: UserDataPaths, resourceRelativePath: string): string {
  if (!resourceRelativePath || resourceRelativePath.startsWith('/') || resourceRelativePath.includes('..')) {
    throw new Error('invalid_content_resource_path')
  }
  const digest = createHash('sha256').update(resourceRelativePath).digest('hex')
  return join(paths.locks, 'resource-' + digest + '.lock')
}

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T> | T,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs
  ensurePrivateDirectory(dirname(lockPath))

  while (true) {
    if (options.signal?.aborted) throw new Error('operation_aborted')
    const lock = openResourceLock(lockPath)
    try {
      lock.run('BEGIN IMMEDIATE')
    } catch (error) {
      lock.close()
      if (!isSqliteBusy(error)) throw error
      if (Date.now() >= deadline) throw new Error('content_resource_lock_timeout')
      await abortableDelay(15, options.signal)
      continue
    }

    let transactionOpen = true
    try {
      const result = await operation()
      transactionOpen = false
      releaseResourceLockTransaction(lock)
      return result
    } catch (error) {
      if (transactionOpen) {
        try { lock.run('ROLLBACK') } catch {}
        transactionOpen = false
      }
      throw error
    } finally {
      lock.close()
    }
  }
}

export function withFileLockSync<T>(
  lockPath: string,
  operation: () => T,
  options: { timeoutMs?: number } = {},
): T {
  const timeoutMs = options.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs
  ensurePrivateDirectory(dirname(lockPath))

  while (true) {
    const lock = openResourceLock(lockPath)
    try {
      lock.run('BEGIN IMMEDIATE')
    } catch (error) {
      lock.close()
      if (!isSqliteBusy(error)) throw error
      if (Date.now() >= deadline) throw new Error('content_resource_lock_timeout')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15)
      continue
    }

    let transactionOpen = true
    try {
      const result = operation()
      transactionOpen = false
      releaseResourceLockTransaction(lock)
      return result
    } catch (error) {
      if (transactionOpen) {
        try { lock.run('ROLLBACK') } catch {}
        transactionOpen = false
      }
      throw error
    } finally {
      lock.close()
    }
  }
}

export function writePrivateFileAtomic(path: string, bytes: Uint8Array | string): void {
  const receipt = publishPrivateFileAtomic(path, bytes)
  if (receipt.durability === 'uncertain') throw receipt.postPublishError
}

export function publishPrivateFileAtomic(
  path: string,
  bytes: Uint8Array | string,
  options: PublishedFileMutationOptions = {},
): PublishedFileMutationReceipt {
  ensurePrivateDirectory(dirname(path))
  assertManagedRegularFile(path)
  const buffer = Buffer.from(bytes)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tempPath = join(dirname(path), '.' + createGeneratedSuffix() + '.tmp')
    let fd: number | undefined
    try {
      fd = openSync(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, PRIVATE_FILE_MODE)
      fchmodSync(fd, PRIVATE_FILE_MODE)
      writeAllSync(fd, buffer)
      fsyncSync(fd)
      fchmodSync(fd, PRIVATE_FILE_MODE)
      closeSync(fd)
      fd = undefined
      renameSync(tempPath, path)
      try {
        (options.syncParentDirectory ?? fsyncDirectory)(dirname(path))
        return { published: true, durability: 'confirmed' }
      } catch (postPublishError) {
        return { published: true, durability: 'uncertain', postPublishError }
      }
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(tempPath) } catch {}
      if (isNodeError(error, 'EEXIST')) continue
      throw error
    }
  }
  throw new Error('atomic_temp_id_collision')
}

export function publishPrivateFileDelete(
  path: string,
  options: PublishedFileMutationOptions = {},
): PublishedFileMutationReceipt {
  assertManagedRegularFile(path)
  unlinkSync(path)
  try {
    (options.syncParentDirectory ?? fsyncDirectory)(dirname(path))
    return { published: true, durability: 'confirmed' }
  } catch (postPublishError) {
    return { published: true, durability: 'uncertain', postPublishError }
  }
}

export function readPrivateFile(path: string): Buffer {
  assertManagedRegularFile(path)
  return readFileSync(path)
}

export function fsyncDirectory(path: string): void {
  const fd = openSync(path, fsConstants.O_RDONLY)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

export function pathEntryExists(path: string): boolean {
  return lstatIfExists(path) !== null
}

function openResourceLock(path: string): Database {
  const info = lstatIfExists(path)
  if (info && (info.isSymbolicLink() || !info.isFile())) throw new Error('content_resource_lock_invalid')
  const lock = new Database(path, { create: true, strict: true })
  try {
    chmodSync(path, PRIVATE_FILE_MODE)
    lock.run('PRAGMA busy_timeout = 0')
    return lock
  } catch (error) {
    lock.close()
    throw error
  }
}

function releaseResourceLockTransaction(lock: Database): void {
  // The SQLite transaction is only an advisory cross-process lock; business bytes
  // have already reached their own publish point before operation() returns.
  try { lock.run('COMMIT') }
  catch { try { lock.run('ROLLBACK') } catch {} }
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && (
    ('code' in error && (error as Error & { code?: unknown }).code === 'SQLITE_BUSY')
    || error.message.includes('database is locked')
  )
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    if (signal?.aborted) {
      reject(new Error('operation_aborted'))
      return
    }
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('operation_aborted'))
    }
    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolveDelay()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function writeAllSync(fd: number, buffer: Buffer): void {
  let offset = 0
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
}

function auditManagedTree(path: string, onWarning: (warning: UserDataWarning) => void): void {
  let entries
  try { entries = readdirSync(path, { withFileTypes: true }) }
  catch (error) {
    if (isNodeError(error, 'ENOENT')) return
    throw error
  }
  for (const entry of entries) {
    const target = join(path, entry.name)
    const info = lstatIfExists(target)
    if (!info) continue
    if (info.isSymbolicLink()) throw new Error('user_data_path_symlink:' + target)
    if (!info.isDirectory() && !info.isFile()) throw new Error('user_data_path_not_regular:' + target)
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      onWarning({ code: 'user_data_permissions_too_open', path: target })
    }
    if (info.isDirectory()) auditManagedTree(target, onWarning)
  }
}

function lstatIfExists(path: string): Stats | null {
  try { return lstatSync(path) }
  catch (error) {
    if (isNodeError(error, 'ENOENT')) return null
    throw error
  }
}
