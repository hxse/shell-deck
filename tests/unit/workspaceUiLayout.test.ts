import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UiLayoutStore } from '../../src/lib/workspace/uiLayoutStore'

test('ui layout store returns defaults and persists config-scoped panel state', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-layout-'))
  try {
    const store = new UiLayoutStore(root)
    expect(store.read('local')).toEqual({
      schemaVersion: 1,
      panels: {
        macro: { visible: true, widthPx: 760 },
        prompt: { visible: false, widthPx: 360 },
      },
      macroInsertionPaletteMode: 'anchored',
    })

    const saved = store.save('local', {
      panels: {
        macro: { visible: false, widthPx: 9999 },
        prompt: { visible: true, widthPx: 200 },
      },
      macroInsertionPaletteMode: 'center',
    })
    expect(saved.panels.macro).toEqual({ visible: false, widthPx: 1200 })
    expect(saved.panels.prompt).toEqual({ visible: true, widthPx: 220 })
    expect(saved.macroInsertionPaletteMode).toBe('center')
    expect(store.read('local')).toEqual(saved)
    expect(store.read('other').panels.macro.visible).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ui layout store rejects path-like config ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-layout-'))
  try {
    const store = new UiLayoutStore(root)
    expect(() => store.save('../bad', {})).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
