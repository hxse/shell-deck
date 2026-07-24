import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import type { RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import { macroDefinitionHash, MacroRunStore } from '../../server/macroRunStore'

const [root, roomId, runId, createdAt] = Bun.argv.slice(2)
if (!root || !roomId || !runId || !createdAt) throw new Error('trace_index_worker_args')

const definition: MacroDefinitionV5 = {
  schemaVersion: 5,
  name: 'trace process writer',
  description: '',
  terminalLayout: [],
  body: [],
}
const store = new MacroRunStore(root, () => createdAt, () => runId)
store.reserveRunId()
writeFileSync(join(root, 'ready-' + runId), '')
while (!existsSync(join(root, 'trace-go'))) await Bun.sleep(5)
const manifest: RunManifestV1 = {
  schemaVersion: 1,
  runId,
  createdAt,
  macroRecord: { id: createGeneratedId('macroTemplate'), revision: 1 },
  definition,
  definitionHash: { algorithm: 'sha256', value: macroDefinitionHash(definition) },
  runtime: {
    serverInstanceId: createGeneratedId('serverInstance'),
    roomId,
    roomGeneration: createGeneratedId('roomGeneration'),
    terminalStructureRevision: 0,
  },
  terminalBindings: [],
}
store.publishManifest(manifest)
store.append(runId, 'run_started')
store.append(runId, 'run_completed')
process.stdout.write(JSON.stringify({ runId, ok: true }))
