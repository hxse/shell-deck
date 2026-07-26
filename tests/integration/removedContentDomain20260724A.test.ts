import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'

test('removed content endpoints use the generic unknown-API response while Macro listing remains live', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-removed-content-http-20260724a-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  try {
    for (const [path, init] of [
      ['/api/library/items?kind=note', undefined],
      ['/api/templates/from-library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'lib_d6gU92rYGn8qqiTBj1WCPo', expectedRevision: 1 }),
      }],
    ] as const) {
      const response = await fetch(server.url + path, init)
      expect(response.status, path).toBe(404)
      expect(await response.json(), path).toEqual({ ok: false, error: 'route_not_found' })
    }

    const macros = await fetch(server.url + '/api/templates')
    expect(macros.status).toBe(200)
    expect(await macros.json()).toEqual({ ok: true, templates: [], invalidRecords: [] })
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
