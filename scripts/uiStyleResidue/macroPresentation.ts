import { issueAt, lineOf, type UiStyleResidueIssue } from './shared'

export function scanMacroPresentationSemantics(file: string, source: string): UiStyleResidueIssue[] {
  const issues: UiStyleResidueIssue[] = []
  const isMacroEditorShell = file === 'src/lib/components/macro/MacroEditorShell.svelte'
    || file.endsWith('/MacroEditorShell.svelte')
  const isMacroPanel = file === 'src/lib/components/MacroPanel.svelte'
    || file.endsWith('/MacroPanel.svelte')
  const isMacroFlowNodeList = file === 'src/lib/components/macro/MacroFlowNodeList.svelte'
    || file.endsWith('/MacroFlowNodeList.svelte')

  if (isMacroEditorShell) {
    const dimmingPatterns = [
      /data-\[editor-locked=true\]:\[&_(?:input|select|textarea)\]:(?:bg-base-(?:100|200|300)|text-base-content\/\d+)/g,
      /data-\[editor-locked=true\]:\[&_\.step-editor\]:opacity-\d+/g,
    ]
    for (const pattern of dimmingPatterns) {
      for (const match of source.matchAll(pattern)) {
        issues.push(issueAt(file, source, match.index, 'saved Macro read-only content must remain full contrast; lock state belongs to the semantic notice'))
      }
    }
    const requiredNoticeTokens = [
      'class:alert-info={normalReadOnly}',
      'class:alert-soft={normalReadOnly}',
      'class:alert-warning={!normalReadOnly && !runLocked}',
      'class:alert-error={runLocked}',
    ]
    for (const token of requiredNoticeTokens) {
      if (!source.includes(token)) {
        issues.push({ file, line: 1, reason: `Macro read-only notice must directly declare semantic state token ${token}` })
      }
    }
    const requiredNoticeActionTokens = [
      'data-click-to-edit={normalReadOnly}',
      "role={normalReadOnly ? 'button' : 'status'}",
      'tabindex={normalReadOnly ? 0 : undefined}',
      'onclick={normalReadOnly ? activateNormalReadOnlyNotice : undefined}',
      'onkeydown={normalReadOnly ? activateNormalReadOnlyNotice : undefined}',
      "if (event.key !== 'Enter' && event.key !== ' ') return",
      'onBeginEdit()',
    ]
    for (const token of requiredNoticeActionTokens) {
      if (!source.includes(token)) {
        issues.push({ file, line: 1, reason: `normal saved Macro notice must exclusively own direct Edit activation token ${token}` })
      }
    }
  }

  if (isMacroPanel && !/<MacroEditorShell[\s\S]*?onBeginEdit=\{\(\) => void beginEdit\(\)\}[\s\S]*?\/>/.test(source)) {
    issues.push({
      file,
      line: 1,
      reason: 'normal saved Macro notice must delegate to the canonical beginEdit content lease path',
    })
  }

  if (isMacroFlowNodeList) {
    const separatorOwner = source.indexOf('class="step-editor flow-node-editor')
    const requiredGuideTokens = [
      'border-l-4',
      'class:border-l-primary={depth % 4 === 0}',
      'class:border-l-secondary={depth % 4 === 1}',
      'class:border-l-accent={depth % 4 === 2}',
      'class:border-l-info={depth % 4 === 3}',
      'after:h-0.5',
      'after:bg-linear-to-r',
      'after:to-transparent',
      "after:content-['']",
      'after:from-primary after:via-primary/70',
      'after:from-secondary after:via-secondary/70',
      'after:from-accent after:via-accent/70',
      'after:from-info after:via-info/70',
    ]
    for (const token of requiredGuideTokens) {
      if (!source.includes(token)) {
        issues.push({
          file,
          line: lineOf(source, separatorOwner < 0 ? 0 : separatorOwner),
          reason: `flow node must pair semantic vertical depth guides with the theme-derived ::after separator token ${token}`,
        })
      }
    }
  }

  return issues
}
