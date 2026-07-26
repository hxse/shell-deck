import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const projectRoot = resolve(import.meta.dir, '../..')

const roomFiles = [
  'tests/e2e/roomRuntimeSync035.takeover.spec.ts',
  'tests/e2e/roomRuntimeSync035.runner.spec.ts',
  'tests/e2e/roomRuntimeSync035.runtime-input.spec.ts',
  'tests/e2e/roomRuntimeSync035.saved-content-save.spec.ts',
  'tests/e2e/roomRuntimeSync035.saved-content-create.spec.ts',
  'tests/e2e/roomRuntimeSync035.saved-content-reconnect.spec.ts',
]

const macroFiles = [
  'tests/e2e/macroWorkbench034.record.spec.ts',
  'tests/e2e/macroWorkbench034.flow.spec.ts',
  'tests/e2e/macroWorkbench034.layout.spec.ts',
  'tests/e2e/macroWorkbench034.feedback.spec.ts',
]

const runtimeFiles = [
  'tests/integration/macroRuntime034.prepare.test.ts',
  'tests/integration/macroRuntime034.execution.test.ts',
  'tests/integration/macroRuntime034.lifecycle.test.ts',
  'tests/integration/macroRuntime034.terminal.test.ts',
  'tests/integration/macroRuntime034.durability.test.ts',
]

const journeyFiles = [...roomFiles, ...macroFiles, ...runtimeFiles]
const helperFiles = [
  'tests/e2e/roomRuntimeSync035.helpers.ts',
  'tests/e2e/macroWorkbench034.helpers.ts',
  'tests/integration/macroRuntime034.helpers.ts',
  'tests/e2e/comprehensiveMacroUiBehaviorCurrent.helpers.ts',
  'tests/e2e/comprehensiveMacroUiBehaviorCurrent.steps-authoring.ts',
  'tests/e2e/comprehensiveMacroUiBehaviorCurrent.steps-flow.ts',
  'tests/e2e/comprehensiveMacroUiBehaviorCurrent.steps-runtime.ts',
  'tests/e2e/roomLargeReplay032.helpers.ts',
]
const macroComprehensiveFiles = [
  'tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts',
  ...helperFiles.filter((file) => file.includes('comprehensiveMacroUiBehaviorCurrent')),
]
const roomLargeReplayFiles = [
  'tests/e2e/roomLargeReplay032.stream.spec.ts',
  'tests/e2e/roomLargeReplay032.retention.spec.ts',
  'tests/e2e/roomLargeReplay032.lifecycle.spec.ts',
  'tests/e2e/roomLargeReplay032.helpers.ts',
]
const savedContentFiles = roomFiles.filter((file) => file.includes('saved-content'))
const controlInventoryFiles = [
  'tests/ui-baseline/031B/controlInventory.ts',
  'tests/ui-baseline/031B/controlInventoryHistorical.ts',
  'tests/ui-baseline/031B/controlInventoryCurrent.ts',
  'tests/ui-baseline/031B/controlInventoryEvidence.ts',
]
const oldPrimaryFiles = [
  'tests/e2e/comprehensiveUiBehavior031B.historical.ts',
  'tests/e2e/roomRuntimeSync035.spec.ts',
  'tests/e2e/libraryWorkbench036.spec.ts',
  'tests/e2e/macroWorkbench034.spec.ts',
  'tests/integration/macroRuntime034.test.ts',
  'tests/e2e/roomRuntimeSync035.saved-content.spec.ts',
  'tests/e2e/roomLargeReplay032.spec.ts',
]
const splitBaseline = JSON.parse(readProjectFile(
  'tests/test-baseline/20260723C.013/mutableTestInventory.json',
)) as SplitBaseline
const currentMacroComprehensive = {
  ...splitBaseline.macroComprehensive,
  postSplitSourceSha256: '050c619437911baabc9b4258cf723b481ffd4908cbc0df60ae662f492fbbd547',
}
const currentRoomLargeReplay = {
  ...splitBaseline.roomLargeReplay,
  postSplitSourceSha256: 'a00b81a502b7b9a0355e0ae652d053170c439252352fa280ec0d3830a64f0883',
  caseHashes: {
    ...splitBaseline.roomLargeReplay.caseHashes,
    'visited terminal views survive Shell and Text tab switches without replaying long history':
      '759f1b681dc9e9881fb345ff25287e299c9f28d12cefc68df0d3d6ad363ea500',
  },
}

type CaseInventory = {
  title: string
  expects: number
  routes: number
  waits: number
  hash: string
}

type SourceGroupInventory = {
  titles: string[]
  steps: string[]
  expects: number
  routes: number
  waits: number
  waitForTimeouts: number
  forced: string[]
  caseHashes: Record<string, string>
  sourceDigest: string
  source: string
}

type SplitBaseline = {
  macroComprehensive: SourceExpectation & { titles: string[]; steps: string[] }
  roomLargeReplay: SourceExpectation & { caseHashes: Record<string, string> }
  savedContent: SourceExpectation & { caseHashes: Record<string, string> }
}

type SourceExpectation = {
  postSplitSourceSha256: string
  expects: number
  routes: number
  waits: number
  waitForTimeouts: number
  forced: string[]
}

test('current journeys preserve every attributed case, assertion and forced gate', () => {
  const inventory = journeyFiles.flatMap(readCaseInventory).sort((left, right) => left.title.localeCompare(right.title))
  const aggregate = createHash('sha256').update(JSON.stringify(inventory)).digest('hex')

  expect(inventory).toHaveLength(40)
  expect(new Set(inventory.map(({ title }) => title)).size).toBe(40)
  expect(inventory.reduce((total, item) => total + item.expects, 0)).toBe(451)
  expect(inventory.reduce((total, item) => total + item.routes, 0)).toBe(18)
  expect(inventory.reduce((total, item) => total + item.waits, 0)).toBe(20)
  expect(aggregate).toBe('f9ebdd11e4a8ea82502e71cc4d6908ec5cae92559e944fa4c370f9bf5f7dabe1')

  expect(roomFiles.flatMap(readCaseInventory)).toHaveLength(14)
  expect(macroFiles.flatMap(readCaseInventory)).toHaveLength(11)
  expect(runtimeFiles.flatMap(readCaseInventory)).toHaveLength(15)

  const source = journeyFiles.map(readProjectFile).join('\n')
  expect(source.match(/\.waitForTimeout\(/g) ?? []).toHaveLength(1)
  expect(source).not.toMatch(/\btest\.(?:only|skip)\s*\(/)
  expect(source).not.toMatch(/\btest\.describe\.(?:only|skip)\s*\(/)
})

test('public Gates discover every current E2E split and retain the .031B and .038 closeout coverage', () => {
  const splitFiles = [
    ...journeyFiles,
    ...helperFiles,
    ...macroComprehensiveFiles,
    ...roomLargeReplayFiles,
    ...controlInventoryFiles,
  ]
  for (const file of new Set(splitFiles)) expect(existsSync(resolve(projectRoot, file))).toBe(true)
  for (const file of oldPrimaryFiles) expect(existsSync(resolve(projectRoot, file))).toBe(false)

  const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> }
  const justfile = readProjectFile('justfile')
  const publicGate = [packageJson.scripts['test:unit:core'], packageJson.scripts['test:integration'], packageJson.scripts['test:e2e'], packageJson.scripts['test:031b']].join(' ')
  for (const file of oldPrimaryFiles) expect(publicGate).not.toContain(file)
  for (const file of oldPrimaryFiles) expect(justfile).not.toContain(file)

  expect(packageJson.scripts['test:e2e']).toBe('bun run scripts/runPlaywright.ts --workers=1')
  for (const file of [...roomFiles, ...macroFiles]) expect(file.endsWith('.spec.ts')).toBe(true)
  for (const file of runtimeFiles) expect(packageJson.scripts['test:integration'].split(file)).toHaveLength(2)
  expect(packageJson.scripts['test:unit:core']).toContain('tests/unit/currentTestJourneyInventory010.test.ts')
  expect(packageJson.scripts['test:031b']).toContain('tests/unit/uiBehaviorInventory031B.test.ts')
  expect(packageJson.scripts['test:integration']).toContain('tests/integration/agentEventWaitLimit038.test.ts')
  expect(existsSync(resolve(projectRoot, 'tests/e2e/agentEventWaitLimit038.spec.ts'))).toBe(true)
  for (const file of [
    ...macroComprehensiveFiles.filter((path) => path.endsWith('.spec.ts')),
    ...roomLargeReplayFiles.filter((path) => path.endsWith('.spec.ts')),
    ...savedContentFiles,
  ]) expect(justfile).toContain(file)
})

test('mutable split groups preserve pre-split cases, attributed evidence and forced settings', () => {
  const macro = readSourceGroupInventory(macroComprehensiveFiles)
  const largeReplay = readSourceGroupInventory(roomLargeReplayFiles)
  const savedContent = readSourceGroupInventory(savedContentFiles)

  expect(sourceEvidence(macro)).toEqual({
    titles: currentMacroComprehensive.titles,
    steps: currentMacroComprehensive.steps,
    expects: currentMacroComprehensive.expects,
    routes: currentMacroComprehensive.routes,
    waits: currentMacroComprehensive.waits,
    waitForTimeouts: currentMacroComprehensive.waitForTimeouts,
    forced: currentMacroComprehensive.forced,
    sourceDigest: currentMacroComprehensive.postSplitSourceSha256,
  })
  expect({
    ...sourceEvidence(largeReplay),
    caseHashes: largeReplay.caseHashes,
  }).toEqual({
    titles: Object.keys(currentRoomLargeReplay.caseHashes).sort(),
    steps: [],
    expects: currentRoomLargeReplay.expects,
    routes: currentRoomLargeReplay.routes,
    waits: currentRoomLargeReplay.waits,
    waitForTimeouts: currentRoomLargeReplay.waitForTimeouts,
    forced: currentRoomLargeReplay.forced,
    sourceDigest: currentRoomLargeReplay.postSplitSourceSha256,
    caseHashes: currentRoomLargeReplay.caseHashes,
  })
  expect({
    ...sourceEvidence(savedContent),
    caseHashes: savedContent.caseHashes,
  }).toEqual({
    titles: Object.keys(splitBaseline.savedContent.caseHashes).sort(),
    steps: [],
    expects: splitBaseline.savedContent.expects,
    routes: splitBaseline.savedContent.routes,
    waits: splitBaseline.savedContent.waits,
    waitForTimeouts: splitBaseline.savedContent.waitForTimeouts,
    forced: [],
    sourceDigest: splitBaseline.savedContent.postSplitSourceSha256,
    caseHashes: splitBaseline.savedContent.caseHashes,
  })

  for (const group of [macro, largeReplay, savedContent]) {
    expect(group.source).not.toMatch(/\btest\.(?:only|skip)\s*\(/)
    expect(group.source).not.toMatch(/\btest\.describe\.(?:only|skip)\s*\(/)
  }
})

test('all split test sources stay bounded and the retired historical journey is absent', () => {
  const boundedFiles = [
    ...macroComprehensiveFiles,
    ...roomLargeReplayFiles,
    ...savedContentFiles,
    ...controlInventoryFiles,
    'tests/unit/currentTestJourneyInventory010.test.ts',
    'tests/unit/uiBehaviorInventory031B.test.ts',
  ]
  for (const file of boundedFiles) {
    expect(readProjectFile(file).trimEnd().split('\n').length, file).toBeLessThanOrEqual(400)
  }
  expect(existsSync(resolve(
    projectRoot,
    'tests/e2e/comprehensiveUiBehavior031B.historical.ts',
  ))).toBe(false)
})

function readCaseInventory(file: string): CaseInventory[] {
  const source = readProjectFile(file)
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return []
    if (statement.expression.expression.getText(sourceFile) !== 'test') return []
    const titleNode = statement.expression.arguments[0]
    if (!titleNode || !ts.isStringLiteral(titleNode)) throw new Error(`non_literal_test_title:${file}`)

    let expects = 0
    let routes = 0
    let waits = 0
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile)
        if (callee === 'expect') expects += 1
        if (callee.endsWith('.route')) routes += 1
        if (callee.includes('waitFor')) waits += 1
      }
      ts.forEachChild(node, visit)
    }
    visit(statement)

    const testSource = statement.getText(sourceFile)
    return [{
      title: titleNode.text,
      expects,
      routes,
      waits,
      hash: createHash('sha256').update(testSource).digest('hex'),
    }]
  })
}

function readSourceGroupInventory(files: string[]): SourceGroupInventory {
  const result: SourceGroupInventory = {
    titles: [],
    steps: [],
    expects: 0,
    routes: 0,
    waits: 0,
    waitForTimeouts: 0,
    forced: [],
    caseHashes: {},
    sourceDigest: '',
    source: '',
  }
  const sourceHashes: Array<[string, string]> = []
  for (const file of files) {
    const source = readProjectFile(file)
    result.source += source + '\n'
    sourceHashes.push([file, createHash('sha256').update(source).digest('hex')])
    for (const item of readCaseInventory(file)) result.caseHashes[item.title] = item.hash
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile)
        const title = node.arguments[0]
        if (callee === 'test' && title && ts.isStringLiteral(title)) result.titles.push(title.text)
        if (callee === 'test.step' && title && ts.isStringLiteral(title)) result.steps.push(title.text)
        if (callee === 'expect') result.expects += 1
        if (callee.endsWith('.route')) result.routes += 1
        if (callee.includes('waitFor')) result.waits += 1
        if (callee.endsWith('.waitForTimeout')) result.waitForTimeouts += 1
        if (isForcedCall(callee)) result.forced.push(node.getText(sourceFile))
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  result.titles.sort()
  result.forced.sort()
  result.sourceDigest = createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex')
  return result
}

function sourceEvidence(group: SourceGroupInventory) {
  return {
    titles: group.titles,
    steps: group.steps,
    expects: group.expects,
    routes: group.routes,
    waits: group.waits,
    waitForTimeouts: group.waitForTimeouts,
    forced: group.forced,
    sourceDigest: group.sourceDigest,
  }
}

function isForcedCall(callee: string): boolean {
  return callee === 'test.setTimeout'
    || callee === 'test.describe.configure'
    || callee.endsWith('.setDefaultTimeout')
    || callee.endsWith('.setDefaultNavigationTimeout')
}

function readProjectFile(file: string): string {
  return readFileSync(resolve(projectRoot, file), 'utf8')
}
