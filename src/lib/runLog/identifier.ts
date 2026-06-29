import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { assertValidPublicId } from '../identifier'

export function assertRunId(runId: string): string {
  return assertValidPublicId(runId, 'genericId')
}

export function assertEventId(eventId: string): string {
  return assertValidPublicId(eventId, 'genericId')
}

export function assertStepId(stepId: string): string {
  return assertValidPublicId(stepId, 'genericId')
}

export function assertArtifactRef(ref: string): string {
  if (typeof ref !== 'string' || !ref.startsWith('artifacts/')) throw new Error('invalid_artifact_ref:' + ref)
  if (ref.includes('\\')) throw new Error('invalid_artifact_ref:' + ref)
  if (isAbsolute(ref)) throw new Error('invalid_artifact_ref:' + ref)
  const parts = ref.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) throw new Error('invalid_artifact_ref:' + ref)
  return ref
}

export function assertContainedPath(root: string, candidate: string): string {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(resolvedRoot + sep)) {
    throw new Error('path_escape:' + candidate)
  }
  return resolvedCandidate
}

export function assertNoSymlinkEscape(root: string, candidate: string): void {
  const resolvedRootPath = resolve(root)
  const realRoot = existsSync(root) ? realpathSync(root) : resolvedRootPath
  let current = resolve(candidate)
  while (current !== resolvedRootPath && current.startsWith(resolvedRootPath + sep)) {
    if (existsSync(current)) {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error('symlink_artifact_escape:' + candidate)
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  if (existsSync(candidate)) {
    const real = realpathSync(candidate)
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error('symlink_artifact_escape:' + candidate)
  }
}
