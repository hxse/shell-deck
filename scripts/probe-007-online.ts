import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCodexExecParser } from '../src/lib/parser/codexExecParserAdapter'
import { loadParserProfile } from '../src/lib/parser/parserProfileLoader'
import { RunEventStore } from '../src/lib/runLog/runEventStore'

if (!process.argv.includes('--run-online')) {
  console.log('missing --run-online; skipping .007 online parser probe')
  process.exit(0)
}

const root = mkdtempSync(join(tmpdir(), 'shell-deck-007-online-'))
try {
  const profileId = process.env.SHELL_DECK_PARSER_PROFILE || 'review-routing-v1'
  const profile = loadParserProfile(profileId)
  const store = new RunEventStore(root)
  const run = await store.createRun('local', { templateId: 'probe-007-online', templateName: 'probe-007-online' })
  const result = await runCodexExecParser(profile, 'AI can directly fix the P2 issue. No user decision is required.', {
    configId: 'local',
    runId: run.runId,
    stepId: 'parse_probe',
    captureArtifactRef: 'artifacts/probe-capture.txt',
    writeArtifact: async (prefix, content, extension = 'txt') => {
      return (await store.writeArtifact('local', run.runId, prefix, content, extension, 'parse_probe')).artifact.artifactRef
    },
  })
  console.log(JSON.stringify({ ok: true, profileId, signals: result.signals, artifacts: { raw: result.rawArtifactRef, normalized: result.normalizedArtifactRef, input: result.inputArtifactRef } }, null, 2))
} finally {
  rmSync(root, { recursive: true, force: true })
}
