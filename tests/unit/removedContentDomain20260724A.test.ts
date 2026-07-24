import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertContentResourceKey, contentResourceKeyString } from '../../src/lib/contentEditLease'
import { GENERATED_ID_PREFIX, createGeneratedId } from '../../src/lib/generatedId'
import { initializeUserDataRoot, USER_DATA_DIRECTORIES } from '../../server/userDataRoot'

const projectRoot = resolve(import.meta.dir, '../..')

test('current saved-content identity and managed storage are Macro-only', () => {
  const macroKey = { kind: 'macro', itemId: createGeneratedId('macroTemplate') } as const
  expect(assertContentResourceKey(macroKey)).toEqual(macroKey)
  expect(contentResourceKeyString(macroKey)).toBe(`macro:${macroKey.itemId}`)
  expect(() => assertContentResourceKey({
    kind: 'library',
    itemKind: 'macro-template',
    itemId: 'lib_d6gU92rYGn8qqiTBj1WCPo',
  })).toThrow('invalid_content_resource_key')
  expect(Object.hasOwn(GENERATED_ID_PREFIX, 'libraryItem')).toBe(false)
  expect(USER_DATA_DIRECTORIES).toEqual(['macros', 'runs', 'agent-events', '.locks'])
})

test('startup and production source no longer own the removed content domain', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-removed-content-20260724a-'))
  try {
    const paths = initializeUserDataRoot(root)
    expect(existsSync(join(paths.root, 'library'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  for (const path of [
    'server/libraryStore.ts',
    'src/lib/components/LibraryPanel.svelte',
    'src/lib/library',
  ]) {
    expect(existsSync(resolve(projectRoot, path)), path).toBe(false)
  }
})
