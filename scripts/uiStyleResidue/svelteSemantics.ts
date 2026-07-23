import { parse } from 'svelte/compiler'
import { lineOf, issueAt, type UiStyleResidueIssue } from './shared'

const BUTTON_SURFACE_VARIANTS = [
  'btn-primary',
  'btn-secondary',
  'btn-success',
  'btn-warning',
  'btn-error',
  'btn-ghost',
] as const

export function scanInteractiveComponentSemantics(file: string, source: string): UiStyleResidueIssue[] {
  const issues: UiStyleResidueIssue[] = []
  const ast = parse(source, { modern: true }) as unknown as { fragment: unknown }

  walkSvelteAst(ast.fragment, (node) => {
    const record = node as {
      type?: string
      name?: string
      start?: number
      attributes?: Array<{ type?: string; name?: string; start?: number; end?: number }>
    }
    if (record.type !== 'RegularElement') return

    const attributes = record.attributes ?? []
    const element = record.name ?? 'control'
    const roleSource = attributeValueSource(attributes, 'role', source)
    const semanticTab = roleSource === 'tab'
    if (!['button', 'input', 'select', 'textarea'].includes(element) && !semanticTab) return

    const classSource = attributeValueSource(attributes, 'class', source)
    const classes = new Set(classSource.split(/\s+/).filter(Boolean))
    const line = lineOf(source, record.start ?? 0)
    const invisibleControl = element === 'button' && ['dismiss-layer', 'insertion-scrim', 'resize-handle']
      .some((marker) => classSource.includes(marker))

    if (classSource.includes('btn-outline')) {
      issues.push({ file, line, reason: 'interactive control must use a daisyUI solid semantic or intentional ghost state instead of btn-outline' })
    }
    if (classSource.includes('btn-soft')) {
      issues.push({ file, line, reason: 'visible command must not use low-contrast btn-soft in the business theme' })
    }
    if (classSource.includes('border-base-300')) {
      issues.push({ file, line, reason: 'interactive control must not consume the structural border-base-300 token' })
    }
    for (const className of classes) {
      if (className === 'border' || isVisibleBorderUtility(className)) {
        issues.push({ file, line, reason: `interactive control uses explicit visible border utility ${className}` })
      }
    }

    if (semanticTab) {
      if (!classes.has('tab')) issues.push({ file, line, reason: 'role=tab control must directly declare daisyUI tab semantics' })
      return
    }

    if (element === 'button') {
      if (!invisibleControl && !classes.has('btn') && !classes.has('tab')) {
        issues.push({ file, line, reason: 'visible button must directly declare daisyUI btn or tab semantics' })
      }
      if (!invisibleControl && classes.has('btn') && !BUTTON_SURFACE_VARIANTS.some((variant) => classSource.includes(variant))) {
        issues.push({ file, line, reason: 'visible btn must declare a solid semantic surface or an intentional btn-ghost tertiary state' })
      }
      return
    }

    const typeSource = attributeValueSource(attributes, 'type', source)
    if (element === 'input' && typeSource === 'checkbox') {
      if (!classes.has('checkbox')) issues.push({ file, line, reason: 'checkbox input must directly declare daisyUI checkbox semantics' })
      return
    }
    if (element === 'input' && typeSource === 'range') {
      if (!classes.has('range')) issues.push({ file, line, reason: 'range input must directly declare daisyUI range semantics' })
      return
    }

    const componentClass = element === 'input' ? 'input' : element
    const ghostClass = `${componentClass}-ghost`
    if (!classes.has(componentClass)) {
      issues.push({ file, line, reason: `${element} must directly declare daisyUI ${componentClass} semantics` })
    }
    if (!classes.has('box-border')) {
      issues.push({ file, line, reason: `${element} must directly declare box-border because the project does not load Tailwind preflight` })
    }
    if (!classes.has(ghostClass) && !classes.has('border-0') && !classes.has('!border-0')) {
      issues.push({ file, line, reason: `${element} must use the daisyUI ${ghostClass} surface or an explicit borderless composite-editor exception` })
    }
    if (classes.has(ghostClass) && !classes.has('bg-base-content/15')) {
      issues.push({ file, line, reason: `${element} ${ghostClass} must pair with the single theme-derived bg-base-content/15 field fill` })
    }
  })

  if (file.endsWith('/MacroPanel.svelte') || file === 'src/lib/components/MacroPanel.svelte') {
    for (const match of source.matchAll(/\[&_(?:button|input|select|textarea)(?:[^\]]*)\]/g)) {
      issues.push(issueAt(file, source, match.index, 'MacroPanel ancestor control presentation is forbidden; declare the daisyUI component on the control itself'))
    }
  }
  return issues
}

function attributeValueSource(
  attributes: Array<{ type?: string; name?: string; start?: number; end?: number }>,
  name: string,
  source: string,
): string {
  const attribute = attributes.find((candidate) => candidate.type === 'Attribute' && candidate.name === name)
  if (!attribute || typeof attribute.start !== 'number' || typeof attribute.end !== 'number') return ''
  const text = source.slice(attribute.start, attribute.end)
  const quoted = text.match(/^[^=]+=["']([\s\S]*)["']$/)
  return quoted?.[1] ?? ''
}

function isVisibleBorderUtility(className: string): boolean {
  const utility = className.split(':').at(-1)?.replace(/^!/, '') ?? ''
  if (utility === 'border-0') return false
  return utility === 'border' || /^border-(?:transparent|base-|primary|secondary|accent|neutral|info|success|warning|error)/.test(utility)
}

function walkSvelteAst(value: unknown, visit: (node: object) => void): void {
  if (!value || typeof value !== 'object') return
  visit(value)
  for (const [key, child] of Object.entries(value)) {
    if (key === 'parent' || key === 'metadata' || key === 'loc') continue
    if (Array.isArray(child)) {
      for (const item of child) walkSvelteAst(item, visit)
    } else {
      walkSvelteAst(child, visit)
    }
  }
}
