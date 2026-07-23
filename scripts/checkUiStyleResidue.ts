import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DAISY_UI_THEME_IDS } from '../src/lib/theme'
import {
  registeredThemeIds,
  scanAppCss,
  scanCssImports,
  scanThemeCatalogOwners,
} from './uiStyleResidue/appCss'
import { scanMacroPresentationSemantics } from './uiStyleResidue/macroPresentation'
import {
  collectSourceFiles,
  dedupeIssues,
  issueAt,
  projectPath,
  scanProductionColorText,
  type UiStyleResidueIssue,
} from './uiStyleResidue/shared'
import { scanInteractiveComponentSemantics } from './uiStyleResidue/svelteSemantics'

export type { UiStyleResidueIssue } from './uiStyleResidue/shared'
export { registeredThemeIds, scanAppCss } from './uiStyleResidue/appCss'
export { scanMacroPresentationSemantics } from './uiStyleResidue/macroPresentation'
export { scanProductionColorText } from './uiStyleResidue/shared'
export { scanInteractiveComponentSemantics } from './uiStyleResidue/svelteSemantics'

export function scanUiStyleResidue(projectRoot = resolve(import.meta.dir, '..')): UiStyleResidueIssue[] {
  const issues: UiStyleResidueIssue[] = []
  const sourceRoot = resolve(projectRoot, 'src')
  const sourceFiles = collectSourceFiles(sourceRoot)
  const cssFiles = sourceFiles.filter((path) => path.endsWith('.css')).map((path) => projectPath(projectRoot, path)).sort()

  if (cssFiles.join('\n') !== 'src/app.css') {
    issues.push({
      file: 'src',
      line: 1,
      reason: `CSS manifest must be exactly src/app.css; found ${cssFiles.length ? cssFiles.join(', ') : 'none'}`,
    })
  }
  if (existsSync(resolve(projectRoot, 'src/styles'))) {
    issues.push({ file: 'src/styles', line: 1, reason: 'legacy styles directory must not exist' })
  }

  for (const path of sourceFiles) {
    const file = projectPath(projectRoot, path)
    const source = readFileSync(path, 'utf8')
    if (path.endsWith('.svelte')) {
      for (const match of source.matchAll(/<style\b/gi)) {
        issues.push(issueAt(file, source, match.index, 'project-authored Svelte <style> block is forbidden'))
      }
      issues.push(...scanInteractiveComponentSemantics(file, source))
      issues.push(...scanMacroPresentationSemantics(file, source))
    }
    if (path.endsWith('.svelte') || path.endsWith('.ts')) {
      issues.push(...scanCssImports(file, source))
    }
    if (file !== 'src/lib/terminal/xtermTheme.ts') {
      issues.push(...scanProductionColorText(file, source))
    }
  }

  const appCssPath = resolve(projectRoot, 'src/app.css')
  const appCssExists = existsSync(appCssPath)
  const appCss = appCssExists ? readFileSync(appCssPath, 'utf8') : ''
  if (appCssExists) issues.push(...scanAppCss(appCss))
  issues.push(...scanThemeCatalogOwners(projectRoot, appCss))
  return dedupeIssues(issues)
}

if (import.meta.main) {
  const issues = scanUiStyleResidue()
  if (issues.length > 0) {
    for (const issue of issues) console.error(`${issue.file}:${issue.line}: ${issue.reason}`)
    console.error(`ui-style-residue: ${issues.length} violation(s)`)
    process.exit(1)
  }
  console.log(`ui-style-residue: clean; src/app.css is the only project CSS source, ${DAISY_UI_THEME_IDS.length} built-in themes are registered, and interactive controls use direct daisyUI semantics`)
}
