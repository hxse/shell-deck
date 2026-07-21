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
  'tests/e2e/roomRuntimeSync035.saved-content.spec.ts',
]

const libraryFiles = [
  'tests/e2e/libraryWorkbench036.crud.spec.ts',
  'tests/e2e/libraryWorkbench036.navigation.spec.ts',
  'tests/e2e/libraryWorkbench036.races.spec.ts',
  'tests/e2e/libraryWorkbench036.reconnect.spec.ts',
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

const journeyFiles = [...roomFiles, ...libraryFiles, ...macroFiles, ...runtimeFiles]
const helperFiles = [
  'tests/e2e/roomRuntimeSync035.helpers.ts',
  'tests/e2e/libraryWorkbench036.helpers.ts',
  'tests/e2e/macroWorkbench034.helpers.ts',
  'tests/integration/macroRuntime034.helpers.ts',
]
const oldPrimaryFiles = [
  'tests/e2e/roomRuntimeSync035.spec.ts',
  'tests/e2e/libraryWorkbench036.spec.ts',
  'tests/e2e/macroWorkbench034.spec.ts',
  'tests/integration/macroRuntime034.test.ts',
]

type CaseInventory = {
  title: string
  expects: number
  routes: number
  waits: number
  hash: string
}

test('split current journeys preserve every original case, assertion and forced gate byte-for-byte', () => {
  const inventory = journeyFiles.flatMap(readCaseInventory).sort((left, right) => left.title.localeCompare(right.title))
  const aggregate = createHash('sha256').update(JSON.stringify(inventory)).digest('hex')

  expect(inventory).toHaveLength(50)
  expect(new Set(inventory.map(({ title }) => title)).size).toBe(50)
  expect(inventory.reduce((total, item) => total + item.expects, 0)).toBe(644)
  expect(inventory.reduce((total, item) => total + item.routes, 0)).toBe(27)
  expect(inventory.reduce((total, item) => total + item.waits, 0)).toBe(20)
  expect(aggregate).toBe('b47e58e82a8fbd5d56e104b1d40e2ed9f06d70d9eb7e3f34ec87b9870c562b0a')

  expect(roomFiles.flatMap(readCaseInventory)).toHaveLength(14)
  expect(libraryFiles.flatMap(readCaseInventory)).toHaveLength(11)
  expect(macroFiles.flatMap(readCaseInventory)).toHaveLength(10)
  expect(runtimeFiles.flatMap(readCaseInventory)).toHaveLength(15)

  const source = journeyFiles.map(readProjectFile).join('\n')
  expect(source.match(/\.waitForTimeout\(/g) ?? []).toHaveLength(1)
  expect(source).not.toMatch(/\btest\.(?:only|skip)\s*\(/)
  expect(source).not.toMatch(/\btest\.describe\.(?:only|skip)\s*\(/)
})

test('public Gates discover every current E2E split and retain the .031B and .038 closeout coverage', () => {
  for (const file of [...journeyFiles, ...helperFiles]) expect(existsSync(resolve(projectRoot, file))).toBe(true)
  for (const file of oldPrimaryFiles) expect(existsSync(resolve(projectRoot, file))).toBe(false)

  const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> }
  const publicGate = [packageJson.scripts['test:unit:core'], packageJson.scripts['test:integration'], packageJson.scripts['test:e2e'], packageJson.scripts['test:031b']].join(' ')
  for (const file of oldPrimaryFiles) expect(publicGate).not.toContain(file)

  expect(packageJson.scripts['test:e2e']).toBe('bun run scripts/runPlaywright.ts --workers=1')
  for (const file of [...roomFiles, ...macroFiles, ...libraryFiles]) expect(file.endsWith('.spec.ts')).toBe(true)
  for (const file of runtimeFiles) expect(packageJson.scripts['test:integration'].split(file)).toHaveLength(2)
  for (const file of libraryFiles) {
    expect(packageJson.scripts['test:031b'].split(file)).toHaveLength(2)
  }

  expect(packageJson.scripts['test:unit:core']).toContain('tests/unit/currentTestJourneyInventory010.test.ts')
  expect(packageJson.scripts['test:031b']).toContain('tests/unit/uiBehaviorInventory031B.test.ts')
  expect(packageJson.scripts['test:integration']).toContain('tests/integration/agentEventWaitLimit038.test.ts')
  expect(existsSync(resolve(projectRoot, 'tests/e2e/agentEventWaitLimit038.spec.ts'))).toBe(true)
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

function readProjectFile(file: string): string {
  return readFileSync(resolve(projectRoot, file), 'utf8')
}
