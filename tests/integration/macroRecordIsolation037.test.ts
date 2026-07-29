import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'

test('Macro list keeps valid V6 records visible and reports invalid V5 records without reading legacy definitions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-macro-list-037-'))
  const store = new MacroRecordStore<MacroDefinitionV6>(root)
  const valid = await store.create({ schemaVersion: 6, name: 'Valid V6', description: '', terminalLayout: [], body: [] })
  const legacy = await store.create({ schemaVersion: 5, name: 'Legacy V5', description: '', terminalLayout: [], body: [] } as unknown as MacroDefinitionV6)
  const malformedId = createGeneratedId('macroTemplate')
  writeFileSync(store.recordPath(malformedId), '{', { mode: 0o600 })
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })

  try {
    const response = await fetch(server.url + '/api/templates')
    expect(response.status).toBe(200)
    const body = await response.json() as {
      ok: boolean
      templates: Array<{ id: string; name: string }>
      invalidRecords: Array<{ recordId: string; error: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.templates).toEqual([expect.objectContaining({ id: valid.id, name: 'Valid V6' })])
    expect(body.invalidRecords).toHaveLength(2)
    expect(body.invalidRecords).toContainEqual({ recordId: legacy.id, error: 'invalid_macro_record_definition' })
    expect(body.invalidRecords).toContainEqual({ recordId: malformedId, error: 'invalid_macro_record' })

    const legacyRead = await fetch(server.url + '/api/templates/' + encodeURIComponent(legacy.id))
    expect(legacyRead.status).toBe(400)
    expect(await legacyRead.json()).toEqual({ ok: false, error: 'invalid_macro_record_definition' })
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
