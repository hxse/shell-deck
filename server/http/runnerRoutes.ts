import { assertGeneratedId, assertRoomRouteToken } from '../../src/lib/generatedId'
import { validateMacroTerminalLayout } from '../../src/lib/macro/macroDefinitionValidation'
import type { HttpContext, HttpRouteResult } from './httpContext'
import {
  assertNoQuery,
  assertNonNegativeRevision,
  assertPositiveRevision,
  assertTerminalStructureRevision,
  errorMessage,
  exactObject,
  json,
  methodNotAllowed,
  roomControlBearer,
} from './httpPrimitives'

export async function handleRunnerRoutes(req: Request, url: URL, context: HttpContext): Promise<HttpRouteResult> {
  const { macroRunner, manager } = context

  const prepareRoute = /^\/api\/rooms\/([^/]+)\/terminals\/prepare$/.exec(url.pathname)
  if (prepareRoute) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(prepareRoute[1]))
    const body = await exactObject(req, ['terminalLayout', 'expectedTerminalStructureRevision'])
    const layout = validateMacroTerminalLayout(body.terminalLayout)
    if (!layout.ok) return json({ ok: false, error: 'invalid_terminal_layout', issues: layout.issues }, 400)
    const expectedRevision = assertTerminalStructureRevision(body.expectedTerminalStructureRevision)
    const result = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await manager.runTerminalStructureOperation(ticket, expectedRevision, async () => {
        for (const required of layout.value) {
          ticket.assertAuthorized()
          const positions = manager.terminalPositions(roomId)
          const current = positions[required.index - 1]
          if (current?.type === required.type) continue
          const later = positions.slice(required.index).find((position) => position.type === required.type)
          try {
            if (later) manager.moveTerminal(roomId, later.terminalId, required.index)
            else manager.createTerminal(roomId, { backend: required.type === 'text' ? 'text' : 'real', insertAtIndex: required.index })
          } catch (error) {
            const code = errorMessage(error)
            if (code.startsWith('room_') || code.startsWith('terminal_structure_')) throw error
            const snapshot = manager.roomSnapshot(roomId)
            return { ok: false as const, error: 'terminal_prepare_backend_failed', failedIndex: required.index, operation: later ? 'move' : 'create', snapshot }
          }
          ticket.assertAuthorized()
        }
        return { ok: true as const, snapshot: manager.roomSnapshot(roomId) }
      })
    ), roomId)
    return json(result, result.ok ? 200 : 409)
  }

  const runnerRoute = /^\/api\/rooms\/([^/]+)\/runner(?:\/(start|pause|resume|stop|input-draft|input))?$/.exec(url.pathname)
  const runnerTracesRoute = /^\/api\/rooms\/([^/]+)\/runner\/traces$/.exec(url.pathname)
  if (runnerTracesRoute) {
    assertNoQuery(url)
    if (req.method !== 'GET') return methodNotAllowed(['GET'])
    const roomId = assertRoomRouteToken(decodeURIComponent(runnerTracesRoute[1]))
    manager.roomSummaryById(roomId)
    return json({ ok: true, traces: macroRunner.traces(roomId) })
  }
  if (runnerRoute) {
    assertNoQuery(url)
    const roomId = assertRoomRouteToken(decodeURIComponent(runnerRoute[1]))
    const action = runnerRoute[2]
    if (!action) {
      if (req.method !== 'GET') return methodNotAllowed(['GET'])
      return json({ ok: true, runner: macroRunner.snapshot(roomId) })
    }
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    if (action === 'start') {
      const body = await exactObject(req, ['templateId', 'expectedMacroRevision', 'expectedTerminalStructureRevision'])
      const templateId = assertGeneratedId(body.templateId, 'macroTemplate')
      const expectedMacroRevision = assertPositiveRevision(body.expectedMacroRevision)
      const expectedStructureRevision = assertTerminalStructureRevision(body.expectedTerminalStructureRevision)
      const preflight = macroRunner.preflightStart(templateId)
      const runner = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
        await manager.runTerminalStructureOperation(ticket, expectedStructureRevision, async () => (
          await macroRunner.start(ticket, templateId, expectedMacroRevision, expectedStructureRevision, preflight)
        ))
      ), roomId)
      return json({ ok: true, runner }, 201)
    }
    const body = action === 'input' || action === 'input-draft'
      ? await exactObject(req, ['invocationId', 'value', 'expectedInputRevision'])
      : await exactObject(req, [])
    const runner = await manager.runControlledBearerOperation(roomControlBearer(req), (ticket) => {
      ticket.assertAuthorized()
      if (action === 'pause') return macroRunner.pause(roomId)
      if (action === 'resume') return macroRunner.resume(roomId)
      if (action === 'stop') return macroRunner.stop(roomId)
      if (typeof body.value !== 'string') throw new Error('runner_input_must_be_string')
      const invocationId = assertGeneratedId(body.invocationId, 'runnerInput')
      const expectedInputRevision = assertNonNegativeRevision(body.expectedInputRevision, 'invalid_runner_input_revision')
      return action === 'input-draft'
        ? macroRunner.updateInputDraft(roomId, invocationId, body.value, expectedInputRevision)
        : macroRunner.submitInput(roomId, invocationId, body.value, expectedInputRevision)
    }, roomId)
    return json({ ok: true, runner })
  }

  return null
}
