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
    digest: '92ab25577ab8c78c58b779859cbd10c527af98b2a229356b133ed94fdf628897',
  },
  'MacroDefinitionV5 accepts only index/type terminal layout and current text-list template tokens': {
    expects: 6,
    digest: '03528c893e25d6dc0d6a833377f390d85c221c227fc5ff146c901e67a23cc28c',
  },
  'MacroDefinitionV5 requires an exact AgentEvent waitLimit branch': {
    expects: 11,
    digest: '5087139ad101ae09826eb9aad08f35346da9be2d244cc58005d0d12a6062a149',
  },
  'App Notify repeat count and interval are required exact bounded integers': {
    expects: 5,
    digest: 'aa8bb7ec99e7baae1cd589e856668fc8efabf2a870a25d203413f57c0e79f869',
  },
  'unassigned terminal and required artifact slots are persistable but never runnable': {
    expects: 5,
    digest: '24d00f99ab3baecbdabb1b184c95de7b660b3caaf83c48625381ef928978bb00',
  },
  'unassigned is rejected outside the finite required-reference whitelist': {
    expects: 6,
    digest: '587c9c048ec7ea8a082b38bd49ed2a76f663659f3f4ec0941392af1da5e73328',
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
    digest: '035589bc68f6b9b04dd4d8b0a6af3f3231cbd2c348738baa1c753b3562467e96',
  },
  'optional Flow fields stay optional and negative text selection remains current syntax': {
    expects: 1,
    digest: '02f56e4bf0d42466cadf1249a923dfca283037d61b8d14f1534a0eb4bd75578c',
  },
  'parallel lanes require one final local Output and reject cross-lane artifacts': {
    expects: 4,
    digest: 'f849856e4686d65522c656d04a5f29b500afeba8649c725b73c4c49a808faee3',
  },
} satisfies Record<string, TestEvidence>

test('the split preserves every original test title, expectation count and semantic body digest', () => {
  const actual = collectEvidence()
  expect(actual).toHaveLength(12)
  expect(new Set(actual.map(({ title }) => title)).size).toBe(12)
  expect(actual.reduce((sum, { expects }) => sum + expects, 0)).toBe(64)
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
