import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const TEST_FILES = [
  'macroDefinition034.core.test.ts',
  'macroDefinition034.action.test.ts',
  'macroDefinition034.control.test.ts',
] as const

const BASELINE = {
  'Macro validation keeps the complete multi-issue code, path, message and order across value and JSON gateways': {
    expects: 3,
    digest: '401b3588111995fb784702d5f503d071fe5adacdfdb633ace1e4e3337b827a5a',
  },
  'MacroDefinitionV6 accepts only index/type terminal layout and current text-list template tokens': {
    expects: 6,
    digest: '8f8c070af32b05db6fd3080e61bef0073000efd4ac2c5770924e03e2160563d5',
  },
  'MacroDefinitionV6 requires an exact AgentEvent waitLimit branch': {
    expects: 11,
    digest: '4329a7063c8b53e783897e90a63bf61de948dc9db6f6984d2a895f14ebe3f493',
  },
  'App Notify repeat count and interval are required exact bounded integers': {
    expects: 5,
    digest: '6766237ea65b24dcc2303facd65c741c111a48d45db90693d6ebf2897ed123be',
  },
  'unassigned terminal and required artifact slots are persistable but never runnable': {
    expects: 5,
    digest: 'b31def8104d6251af77f5fde139542687a15a34284e02faf4c5aa60c259c3797',
  },
  'unassigned is rejected outside the finite required-reference whitelist': {
    expects: 13,
    digest: '048a9cd3d104a64252cfc7732c2c8b731a3ef78adb7f7e4ef25b9988d4e6e91a',
  },
  'terminal layout is empty-or-contiguous, unbounded by product policy, and runtime readiness is separate': {
    expects: 5,
    digest: '8d5a1fe0aa20e227fd6500476661620676a0732eeb8f3d62f35aa319db97d78c',
  },
  'terminal selectors expose only live terminal positions and explain unconfirmed, stale or incompatible targets': {
    expects: 8,
    digest: '2b1e39ac55bc206e75573a71cf5fb5eba2e826a0d0bf21a5867a3dbcfaa77864',
  },
  'visual terminal layout is driven by explicit Action targets rather than terminal creation events': {
    expects: 7,
    digest: 'de38a20d4f6521ba96d90c5b274d2b26ffe8c3a619d1773ea08c35f1c4b7e53c',
  },
  'the unique JSON gateway reports deterministic UTF-16 positions and Prepare reads layout only': {
    expects: 3,
    digest: '15b8c4d010efaa20e99d577874ad9adeb7b17947457b610f4e7d9a9e5ef9b605',
  },
  'optional Flow fields stay optional and negative text selection remains current syntax': {
    expects: 1,
    digest: '88c2f752285c3c6e45f80b8c2bab46b65defcca94be9df6960bfc31a368e50fa',
  },
  'parallel panes use explicit action targets, allow empty bodies and reject cross-pane artifacts': {
    expects: 3,
    digest: '0ec58509bfa04b6c5eeca86ec7c77c5283099298921494071959396c0431f417',
  },
} satisfies Record<string, TestEvidence>

test('the split preserves every original test title, expectation count and semantic body digest', () => {
  const actual = collectEvidence()
  expect(actual).toHaveLength(12)
  expect(new Set(actual.map(({ title }) => title)).size).toBe(12)
  expect(actual.reduce((sum, { expects }) => sum + expects, 0)).toBe(70)
  expect(Object.fromEntries(actual.map(({ title, expects, digest }) => [
    title,
    { expects, digest },
  ]))).toEqual(BASELINE)
})

test('the public facade remains the sole production gateway and every split file stays bounded', () => {
  const projectRoot = resolve(import.meta.dir, '../..')
  const macroRoot = resolve(projectRoot, 'src/lib/macro')
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const sources = Object.fromEntries([
    'macroDefinitionValidation.ts',
    'macroNodeValidation.ts',
    'macroActionValidation.ts',
    'macroControlValidation.ts',
    'macroTextMatchValidation.ts',
  ].map((name) => [name, readFileSync(resolve(macroRoot, name), 'utf8')]))
  const productionFiles = filesBelow(resolve(projectRoot, 'src'))

  expect(consumers(projectRoot, productionFiles, 'macroNodeValidation')).toEqual([
    'src/lib/macro/macroDefinitionValidation.ts',
  ])
  expect(consumers(projectRoot, productionFiles, 'macroActionValidation')).toEqual([
    'src/lib/macro/macroNodeValidation.ts',
  ])
  expect(consumers(projectRoot, productionFiles, 'macroControlValidation')).toEqual([
    'src/lib/macro/macroNodeValidation.ts',
  ])
  expect(consumers(projectRoot, productionFiles, 'macroTextMatchValidation')).toEqual([
    'src/lib/macro/macroActionValidation.ts',
    'src/lib/macro/macroControlValidation.ts',
  ])

  expectOrdered(sources['macroNodeValidation.ts'], [
    'const node = object(value, context.issues, path)',
    'validateIdentifier(node.id, context.issues',
    "if (typeof node.type !== 'string')",
    'if (actionOnly &&',
    'switch (node.type)',
  ])
  expect(sources['macroDefinitionValidation.ts']).toContain("import { validateNodeList } from './macroNodeValidation'")
  expect(sources['macroActionValidation.ts']).not.toMatch(/\b(?:const|let)\s+issues\b/)
  expect(sources['macroControlValidation.ts']).not.toMatch(/\b(?:const|let)\s+issues\b/)
  for (const name of [...TEST_FILES, 'macroValidationDecomposition010.test.ts']) {
    expect(packageJson.scripts['test:unit:core']).toContain(`tests/unit/${name}`)
  }
  expect(packageJson.scripts['test:unit:core']).not.toContain('tests/unit/macroDefinition034.test.ts')

  for (const path of [
    ...Object.keys(sources).map((name) => resolve(macroRoot, name)),
    ...TEST_FILES.map((name) => resolve(import.meta.dir, name)),
    resolve(import.meta.dir, 'macroDefinition034.fixtures.ts'),
    import.meta.path,
  ]) {
    expect(readFileSync(path, 'utf8').trimEnd().split('\n').length).toBeLessThanOrEqual(400)
  }
})

type TestEvidence = { expects: number; digest: string }
type NamedTestEvidence = TestEvidence & { title: string }

function collectEvidence(): NamedTestEvidence[] {
  const printer = ts.createPrinter({ removeComments: true })
  const evidence: NamedTestEvidence[] = []
  for (const name of TEST_FILES) {
    const path = resolve(import.meta.dir, name)
    const sourceText = readFileSync(path, 'utf8')
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue
      const call = statement.expression
      if (!ts.isIdentifier(call.expression) || call.expression.text !== 'test') continue
      const [titleNode, body] = call.arguments
      if (!ts.isStringLiteral(titleNode) || !body) continue
      let expects = 0
      visit(body, (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect') {
          expects += 1
        }
      })
      const semanticBody = printer.printNode(ts.EmitHint.Unspecified, body, source)
      evidence.push({
        title: titleNode.text,
        expects,
        digest: createHash('sha256').update(semanticBody).digest('hex'),
      })
    }
  }
  return evidence
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void): void {
  inspect(node)
  ts.forEachChild(node, (child) => visit(child, inspect))
}

function filesBelow(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) files.push(...filesBelow(path))
    else if (entry.isFile() && /\.(?:ts|svelte)$/.test(entry.name)) files.push(path)
  }
  return files
}

function consumers(projectRoot: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"][^'"]*${moduleName}['"]`)
  return files
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(projectRoot, path))
    .sort()
}

function expectOrdered(source: string, needles: string[]): void {
  let offset = 0
  for (const needle of needles) {
    const index = source.indexOf(needle, offset)
    expect(index, `${needle} must remain after the previous phase`).toBeGreaterThanOrEqual(offset)
    offset = index + needle.length
  }
}
