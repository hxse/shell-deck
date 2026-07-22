import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from 'playwright/test'

const outputDirectory = process.env.SHELL_DECK_STYLE_PROBE_OUTPUT

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('Macro and Library workbench computed styles retain the frozen visual contract', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await expect(page.getByTestId('macro-panel')).toBeVisible()

  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-flow-if').click()
  const ifNode = page.locator('[data-flow-node-type="if"]').first()
  await ifNode.getByTestId('node-id-input').fill('if_root')
  const branch = ifNode.getByTestId('if-branch-section').first()
  await branch.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await branch.locator('[data-flow-node-type="send"]').getByTestId('node-id-input').fill('send_nested')
  await ifNode.getByTestId('node-add-after').first().click()
  await page.getByTestId('add-step-parallel').click()
  const parallel = page.locator('[data-flow-node-type="parallel"]').first()
  await parallel.getByTestId('node-id-input').fill('parallel_root')
  await parallel.getByTestId('parallel-lane-id-input').fill('lane_a')
  await parallel.getByTestId('parallel-lane-add-before-output').click()
  await page.getByTestId('parallel-add-capture').click()
  await parallel.getByTestId('parallel-action-id-input').fill('lane_capture')
  await parallel.getByTestId('parallel-collect-lane-text').check()
  await parallel.getByTestId('parallel-output-id-input').fill('lane_output')
  await parallel.getByTestId('parallel-lane-add-before-output').click()
  await page.getByTestId('parallel-add-wait').click()
  await parallel.getByTestId('parallel-action-id-input').last().fill('lane_wait')

  const computed: Record<string, Record<string, string>> = {}
  computed.macroPanel = await styleValues(page.getByTestId('macro-panel'), ['display', 'font-size', 'overflow', 'min-width'])
  computed.macroStickyHead = await styleValues(page.locator('.macro-sticky-head'), ['position', 'top', 'z-index', 'border-bottom-width', 'box-shadow'])
  computed.macroTabs = await styleValues(page.locator('.macro-tabs'), ['display', 'grid-template-columns', 'gap', 'padding', 'position'])
  computed.macroTabButton = await styleValues(page.getByTestId('macro-tab-editor'), ['height', 'padding', 'font-size', 'font-weight', 'background-color'])
  computed.editorLayout = await styleValues(page.locator('.macro-editor-layout'), ['display', 'grid-template-columns', 'gap', 'overflow', 'padding-right', 'margin-bottom'])
  computed.editorInput = await styleValues(ifNode.locator(':scope > .macro-row input').first(), ['min-height', 'padding', 'font-size', 'border-radius'])
  computed.flowBlock = await styleValues(page.getByTestId('flow-block').first(), ['position', 'margin', 'padding-left', '--flow-guide-width', '--flow-indent-offset'])
  computed.flowNode = await styleValues(ifNode, ['margin-left', 'padding', 'border-left-width', 'border-radius', 'background-color', 'box-shadow'])
  computed.flowBranch = await styleValues(branch, ['display', 'gap', 'margin', 'padding', 'border-top-width', 'background-color'])
  computed.parallelTabs = await styleValues(parallel.getByTestId('parallel-lane-tabs'), ['display', 'gap'])
  computed.parallelLane = await styleValues(parallel.getByTestId('parallel-lane-editor'), ['display', 'gap', 'padding', 'border-radius', 'background-color'])
  computed.iconButton = await styleValues(ifNode.getByTestId('node-toggle-collapse').first(), ['display', 'width', 'height', 'padding', 'border-radius'])

  await capture(page.getByTestId('macro-view-scroll'), 'macro-editor.png')
  await ifNode.getByTestId('node-toggle-collapse').first().click()
  computed.collapsedNode = await styleValues(ifNode, ['border-right-color', 'border-bottom-color', 'background-image', 'box-shadow'])
  computed.collapsedBadge = await styleValues(ifNode.getByTestId('node-collapsed-badge'), ['display', 'min-height', 'padding', 'font-size', 'border-radius'])
  await capture(page.getByTestId('macro-view-scroll'), 'macro-collapsed.png')

  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  computed.jsonView = await styleValues(page.getByTestId('macro-json-view'), ['display', 'height', 'overflow', 'padding', 'gap'])
  computed.jsonEditor = await styleValues(page.getByTestId('macro-json-editor'), ['min-height', 'font-family', 'font-size', 'line-height', 'overflow', 'resize'])
  computed.jsonLock = await styleValues(page.getByTestId('macro-json-edit-lock'), ['font-size', 'font-weight', 'color'])
  await capture(page.getByTestId('macro-view-scroll'), 'macro-json.png')
  await page.getByTestId('macro-cancel-json').click()
  await page.getByTestId('macro-tab-trace').click()
  computed.tracePanel = await styleValues(page.getByTestId('macro-trace-view'), ['display', 'font-size', 'min-width', 'border-top-width', 'background-color'])
  computed.traceHeader = await styleValues(page.getByTestId('macro-trace-view').locator('.macro-section-title'), ['display', 'min-height', 'padding', 'gap'])
  computed.traceEmpty = await styleValues(page.getByTestId('macro-trace-view').locator('.empty-text'), ['font-size', 'color', 'margin'])
  await capture(page.getByTestId('macro-view-scroll'), 'macro-trace.png')

  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel')).toBeVisible()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Style Probe')
  await page.getByTestId('library-content').fill('{')
  await page.getByTestId('library-validate').click()
  computed.libraryPanel = await styleValues(page.getByTestId('library-panel'), ['font-size', 'min-width', 'border-top-width', 'background-color'])
  computed.libraryHeader = await styleValues(page.locator('.library-header'), ['position', 'min-height', 'padding', 'gap'])
  computed.libraryTabs = await styleValues(page.getByTestId('library-kind-tabs'), ['display', 'grid-template-columns', 'gap', 'padding', 'background-color'])
  computed.libraryTab = await styleValues(page.getByTestId('library-tab-macro-template'), ['min-height', 'padding', 'font-size', 'overflow'])
  computed.libraryInput = await styleValues(page.getByTestId('library-title'), ['min-height', 'padding', 'font-size', 'border-radius'])
  computed.libraryEditor = await styleValues(page.getByTestId('library-content'), ['padding', 'font-size', 'line-height', 'resize'])
  computed.libraryValidation = await styleValues(page.getByTestId('library-validation'), ['max-height', 'overflow', 'padding', 'font-family', 'font-size'])
  await capture(page.getByTestId('library-panel'), 'library-macro.png')

  await page.getByTestId('library-cancel').click()
  await page.getByTestId('library-tab-prompt').click()
  await capture(page.getByTestId('library-panel'), 'library-prompt.png')
  await page.getByTestId('library-tab-note').click()
  await capture(page.getByTestId('library-panel'), 'library-note.png')

  await page.setViewportSize({ width: 900, height: 1000 })
  computed.responsiveWorkspace = await styleValues(page.getByTestId('workspace-shell'), ['display', 'flex-direction', 'overflow'])
  computed.responsiveSidePanel = await styleValues(page.getByTestId('macro-side-panel'), ['width', 'max-width', 'min-height', 'border-left-width', 'border-top-width'])
  await capture(page.getByTestId('workspace-shell'), 'responsive-workbench.png')

  await page.setViewportSize({ width: 720, height: 1000 })
  computed.narrowRunControls = await styleValues(page.getByTestId('macro-run-controls'), ['display', 'grid-template-columns', 'gap'])

  if (outputDirectory) {
    mkdirSync(outputDirectory, { recursive: true })
    writeFileSync(join(outputDirectory, 'computed.json'), JSON.stringify(computed, null, 2) + '\n')
  }
  expect(computed).toEqual(expectedComputedStyles)
})

const expectedComputedStyles: Record<string, Record<string, string>> = {
  macroPanel: {
    display: 'flex',
    'font-size': '13px',
    overflow: 'hidden',
    'min-width': '0px',
  },
  macroStickyHead: {
    position: 'relative',
    top: '0px',
    'z-index': '5',
    'border-bottom-width': '1px',
    'box-shadow': 'rgba(28, 42, 56, 0.08) 0px 1px 4px 0px',
  },
  macroTabs: {
    display: 'grid',
    'grid-template-columns': '237.328px 237.328px 237.328px',
    gap: '4px',
    padding: '4px 6px',
    position: 'static',
  },
  macroTabButton: {
    height: '28px',
    padding: '0px 6px',
    'font-size': '12px',
    'font-weight': '700',
    'background-color': 'rgb(232, 243, 252)',
  },
  editorLayout: {
    display: 'grid',
    'grid-template-columns': '732px',
    gap: '8px',
    overflow: 'hidden',
    'padding-right': '0px',
    'margin-bottom': '8px',
  },
  editorInput: {
    'min-height': '25px',
    padding: '4px 6px',
    'font-size': '12px',
    'border-radius': '5px',
  },
  flowBlock: {
    position: 'relative',
    margin: '2px 0px 3px 7px',
    'padding-left': '14px',
    '--flow-guide-width': '2px',
    '--flow-indent-offset': '14px',
  },
  flowNode: {
    'margin-left': '-14px',
    padding: '7px 7px 7px 21px',
    'border-left-width': '2px',
    'border-radius': '4px',
    'background-color': 'rgb(251, 252, 254)',
    'box-shadow': 'rgba(30, 46, 62, 0.05) 0px 1px 1px 0px',
  },
  flowBranch: {
    display: 'grid',
    gap: '6px',
    margin: '10px 0px 0px',
    padding: '0px',
    'border-top-width': '0px',
    'background-color': 'rgba(0, 0, 0, 0)',
  },
  parallelTabs: { display: 'grid', gap: '10px' },
  parallelLane: {
    display: 'grid',
    gap: '10px',
    padding: '10px',
    'border-radius': '0px 8px 8px',
    'background-color': 'rgb(255, 255, 255)',
  },
  iconButton: {
    display: 'grid',
    width: '24px',
    height: '24px',
    padding: '0px',
    'border-radius': '4px',
  },
  collapsedNode: {
    'border-right-color': 'color(srgb 0.55098 0.725647 0.871294)',
    'border-bottom-color': 'color(srgb 0.55098 0.725647 0.871294)',
    'background-image': 'linear-gradient(90deg, color(srgb 0.862588 0.921255 0.966824), color(srgb 0.927843 0.957647 0.98) 72%, rgb(247, 250, 252))',
    'box-shadow': 'color(srgb 0.152941 0.52549 0.823529 / 0.12) 0px 2px 5px 0px',
  },
  collapsedBadge: {
    display: 'flex',
    'min-height': '18px',
    padding: '1px 6px',
    'font-size': '9px',
    'border-radius': '999px',
  },
  jsonView: {
    display: 'flex',
    height: '823px',
    overflow: 'hidden',
    padding: '8px',
    gap: '5px',
  },
  jsonEditor: {
    'min-height': '0px',
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'font-size': '14px',
    'line-height': '20.3px',
    overflow: 'auto',
    resize: 'vertical',
  },
  jsonLock: {
    'font-size': '13px',
    'font-weight': '700',
    color: 'rgb(107, 79, 0)',
  },
  tracePanel: {
    display: 'flex',
    'font-size': '13px',
    'min-width': '0px',
    'border-top-width': '1px',
    'background-color': 'rgb(255, 255, 255)',
  },
  traceHeader: {
    display: 'flex',
    'min-height': 'auto',
    padding: '0px',
    gap: '8px',
  },
  traceEmpty: {
    'font-size': '12px',
    color: 'rgb(102, 116, 131)',
    margin: '3px 0px 0px',
  },
  libraryPanel: {
    'font-size': '13px',
    'min-width': '0px',
    'border-top-width': '1px',
    'background-color': 'rgb(255, 255, 255)',
  },
  libraryHeader: {
    position: 'sticky',
    'min-height': '38px',
    padding: '3px 8px',
    gap: '6px',
  },
  libraryTabs: {
    display: 'grid',
    'grid-template-columns': '109.328px 109.328px 109.344px',
    gap: '4px',
    padding: '6px 8px',
    'background-color': 'rgb(247, 249, 251)',
  },
  libraryTab: {
    'min-height': '28px',
    padding: '3px 6px',
    'font-size': '12px',
    overflow: 'hidden',
  },
  libraryInput: {
    'min-height': '26px',
    padding: '4px 6px',
    'font-size': '13px',
    'border-radius': '5px',
  },
  libraryEditor: {
    padding: '7px',
    'font-size': '13px',
    'line-height': '19.5px',
    resize: 'vertical',
  },
  libraryValidation: {
    'max-height': '180px',
    overflow: 'auto',
    padding: '7px 8px',
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'font-size': '12px',
  },
  responsiveWorkspace: {
    display: 'flex',
    'flex-direction': 'column',
    overflow: 'hidden',
  },
  responsiveSidePanel: {
    width: '765px',
    'max-width': '765px',
    'min-height': '260px',
    'border-left-width': '0px',
    'border-top-width': '1px',
  },
  narrowRunControls: {
    display: 'flex',
    'grid-template-columns': 'none',
    gap: '4px',
  },
}

async function styleValues(locator: Locator, properties: string[]): Promise<Record<string, string>> {
  return await locator.evaluate((element, names) => {
    const style = getComputedStyle(element)
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
  }, properties)
}

async function capture(locator: Locator, name: string): Promise<void> {
  if (!outputDirectory) return
  mkdirSync(outputDirectory, { recursive: true })
  await locator.screenshot({ path: join(outputDirectory, name), animations: 'disabled' })
}
