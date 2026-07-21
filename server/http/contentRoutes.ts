import { PROFILE_CATALOG_SUMMARY } from '../../src/lib/parser/profileCatalogSummary'
import { assertGeneratedId } from '../../src/lib/generatedId'
import { assertContentResourceKey } from '../../src/lib/contentEditLease'
import { assertLibraryItemKind, libraryItemSummary, normalizeLibraryItemFields, type InvalidLibraryItemSummary, type LibraryItemKind } from '../../src/lib/library/libraryTypes'
import type { FlowV2Node } from '../../src/lib/macro/macroDefinitionTypes'
import { parseAndValidateMacroDefinitionJson, validateMacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionValidation'
import type { TerminalRoomManager } from '../terminalRoomManager'
import type { HttpContext, HttpRouteResult } from './httpContext'
import {
  assertNoQuery,
  assertPositiveRevision,
  contentEditLeaseHeader,
  exactObject,
  exactQuery,
  json,
  methodNotAllowed,
  parseIfMatch,
  roomControlBearer,
} from './httpPrimitives'

export async function handleContentRoutes(req: Request, url: URL, context: HttpContext): Promise<HttpRouteResult> {
  const { contentEditLeases, libraryStore, macroStore, manager, notificationService } = context

  if (url.pathname === '/api/content-edit-leases/acquire') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['resourceKey', 'expectedLeaseEpoch'])
    const resourceKey = assertContentResourceKey(body.resourceKey)
    const result = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await contentEditLeases.acquire(ticket, resourceKey, body.expectedLeaseEpoch as number)
    ))
    return json({ ok: true, ...result })
  }

  if (url.pathname === '/api/content-edit-leases/view') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['resourceKey'])
    const view = await contentEditLeases.view(assertContentResourceKey(body.resourceKey))
    return json({ ok: true, view })
  }

  if (url.pathname === '/api/content-edit-leases/take-over') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['resourceKey', 'expectedLeaseEpoch', 'confirmed'])
    const resourceKey = assertContentResourceKey(body.resourceKey)
    const result = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await contentEditLeases.takeOver(ticket, resourceKey, body.expectedLeaseEpoch as number, body.confirmed === true)
    ))
    return json({ ok: true, ...result })
  }

  if (url.pathname === '/api/templates') {
    assertNoQuery(url)
    if (req.method === 'GET') {
      const scan = macroStore.scan()
      const invalidRecords: Array<{ recordId: string; error: 'invalid_macro_record' | 'invalid_macro_record_definition' }> = [...scan.invalidRecords]
      const templates = scan.records.flatMap((record) => {
        const validated = validateMacroDefinitionV5(record.definition)
        if (!validated.ok) {
          invalidRecords.push({ recordId: record.id, error: 'invalid_macro_record_definition' })
          return []
        }
        return [{
          id: record.id,
          revision: record.revision,
          name: validated.value.name,
          description: validated.value.description,
          updatedAt: record.updatedAt,
          stepCount: countMacroNodes(validated.value.body),
        }]
      })
      invalidRecords.sort((left, right) => left.recordId.localeCompare(right.recordId))
      return json({ ok: true, templates, invalidRecords })
    }
    if (req.method === 'POST') {
      const body = await exactObject(req, ['definition'])
      const validation = validateMacroDefinitionV5(body.definition)
      if (!validation.ok) return json({ ok: false, error: 'invalid_macro_definition', issues: validation.issues }, 400)
      const template = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => {
        ticket.assertAuthorized()
        return await macroStore.create(validation.value, ticket.signal, () => ticket.assertAuthorized())
      })
      manager.broadcastAllClients(() => ({
        type: 'content_record_changed',
        resourceKey: { kind: 'macro', itemId: template.id },
        operation: 'saved',
        revision: template.revision,
      }))
      return json({ ok: true, template }, 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  if (url.pathname === '/api/library/items') {
    if (req.method === 'GET') {
      const query = exactQuery(url, ['kind', 'q'], ['kind'])
      const kind = assertLibraryItemKind(query.get('kind'))
      const scan = libraryStore.scan(kind, query.get('q') ?? '')
      const invalidItems: InvalidLibraryItemSummary[] = [...scan.invalidItems]
      const items = scan.records.flatMap((item) => {
        if (kind === 'macro-template' && !parseAndValidateMacroDefinitionJson(item.content).ok) {
          invalidItems.push({ itemId: item.itemId, error: 'invalid_library_macro_definition' })
          return []
        }
        return [libraryItemSummary(item)]
      })
      invalidItems.sort((left, right) => left.itemId.localeCompare(right.itemId))
      return json({ ok: true, items, invalidItems })
    }
    assertNoQuery(url)
    if (req.method === 'POST') {
      const body = await exactObject(req, ['kind', 'title', 'content', 'description', 'tags'])
      const kind = assertLibraryItemKind(body.kind)
      const fields = normalizeLibraryItemFields({ title: body.title, content: body.content, description: body.description, tags: body.tags })
      const macroValidation = validateLibraryMacroContent(kind, fields.content)
      if (macroValidation) return macroValidation
      const item = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => {
        ticket.assertAuthorized()
        return await libraryStore.create(kind, fields, ticket.signal, () => ticket.assertAuthorized())
      })
      broadcastLibraryChange(manager, item.kind, item.itemId, 'saved', item.revision)
      return json({ ok: true, item }, 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const libraryItemRoute = /^\/api\/library\/items\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (libraryItemRoute) {
    assertNoQuery(url)
    const kind = assertLibraryItemKind(decodeURIComponent(libraryItemRoute[1]))
    const itemId = assertGeneratedId(decodeURIComponent(libraryItemRoute[2]), 'libraryItem')
    if (req.method === 'GET') {
      const item = libraryStore.read(kind, itemId)
      if (kind === 'macro-template' && !parseAndValidateMacroDefinitionJson(item.content).ok) throw new Error('invalid_library_macro_definition')
      return json({ ok: true, item })
    }
    if (req.method === 'PUT') {
      const body = await exactObject(req, ['title', 'content', 'description', 'tags', 'expectedRevision', 'editLeaseId'])
      const fields = normalizeLibraryItemFields({ title: body.title, content: body.content, description: body.description, tags: body.tags })
      const macroValidation = validateLibraryMacroContent(kind, fields.content)
      if (macroValidation) return macroValidation
      const expectedRevision = assertPositiveRevision(body.expectedRevision, 'invalid_library_item_revision')
      const editLeaseId = assertGeneratedId(body.editLeaseId, 'contentEditLease')
      const committed = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => (
        await contentEditLeases.commit(
          ticket,
          { kind: 'library', itemKind: kind, itemId },
          editLeaseId,
          expectedRevision,
          (_path, currentRevision) => libraryStore.commitUpdate(kind, itemId, currentRevision, fields),
        )
      ))
      const item = committed.value
      broadcastLibraryChange(manager, kind, itemId, 'saved', item.revision)
      return json({ ok: true, item, leaseOutcome: committed.leaseOutcome })
    }
    if (req.method === 'DELETE') {
      if ((await req.text()).length !== 0) throw new Error('request_body_must_be_empty')
      const expectedRevision = parseIfMatch(req, 'invalid_library_item_revision')
      const editLeaseId = contentEditLeaseHeader(req)
      const committed = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => (
        await contentEditLeases.commit(
          ticket,
          { kind: 'library', itemKind: kind, itemId },
          editLeaseId,
          expectedRevision,
          (_path, currentRevision) => libraryStore.commitDelete(kind, itemId, currentRevision),
          { deleteRecord: true },
        )
      ))
      broadcastLibraryChange(manager, kind, itemId, 'deleted', null)
      return json({ ok: true, leaseOutcome: committed.leaseOutcome })
    }
    return methodNotAllowed(['GET', 'PUT', 'DELETE'])
  }

  if (url.pathname === '/api/templates/from-library') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['itemId', 'expectedRevision'])
    const itemId = assertGeneratedId(body.itemId, 'libraryItem')
    const expectedRevision = assertPositiveRevision(body.expectedRevision, 'invalid_library_item_revision')
    const result = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => {
      ticket.assertAuthorized()
      const item = libraryStore.read('macro-template', itemId)
      if (item.revision !== expectedRevision) throw new Error('content_revision_conflict')
      const validation = parseAndValidateMacroDefinitionJson(item.content)
      if (!validation.ok) return { ok: false as const, error: validation.error }
      const created = await macroStore.create(validation.value, ticket.signal, () => {
        ticket.assertAuthorized()
        if (libraryStore.read('macro-template', itemId).revision !== expectedRevision) throw new Error('content_revision_conflict')
      })
      return { ok: true as const, template: created }
    })
    if (!result.ok) return macroValidationResponse(result.error)
    const template = result.template
    manager.broadcastAllClients(() => ({
      type: 'content_record_changed',
      resourceKey: { kind: 'macro', itemId: template.id },
      operation: 'saved',
      revision: template.revision,
    }))
    return json({ ok: true, template }, 201)
  }

  const templateRoute = /^\/api\/templates\/([^/]+)$/.exec(url.pathname)
  if (templateRoute) {
    assertNoQuery(url)
    const templateId = assertGeneratedId(decodeURIComponent(templateRoute[1]), 'macroTemplate')
    if (req.method === 'GET') {
      const template = macroStore.read(templateId)
      if (!validateMacroDefinitionV5(template.definition).ok) throw new Error('invalid_macro_record_definition')
      return json({ ok: true, template })
    }
    if (req.method === 'PUT') {
      const body = await exactObject(req, ['expectedRevision', 'editLeaseId', 'definition'])
      const validation = validateMacroDefinitionV5(body.definition)
      if (!validation.ok) return json({ ok: false, error: 'invalid_macro_definition', issues: validation.issues }, 400)
      const expectedRevision = assertPositiveRevision(body.expectedRevision)
      const editLeaseId = assertGeneratedId(body.editLeaseId, 'contentEditLease')
      const committed = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => (
        await contentEditLeases.commit(
          ticket,
          { kind: 'macro', itemId: templateId },
          editLeaseId,
          expectedRevision,
          (_path, currentRevision) => macroStore.commitUpdate(templateId, currentRevision, validation.value),
        )
      ))
      const template = committed.value
      manager.broadcastAllClients(() => ({
        type: 'content_record_changed',
        resourceKey: { kind: 'macro', itemId: template.id },
        operation: 'saved',
        revision: template.revision,
      }))
      return json({ ok: true, template, leaseOutcome: committed.leaseOutcome })
    }
    if (req.method === 'DELETE') {
      if ((await req.text()).length !== 0) throw new Error('request_body_must_be_empty')
      const expectedRevision = parseIfMatch(req)
      const editLeaseId = contentEditLeaseHeader(req)
      const committed = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => (
        await contentEditLeases.commit(
          ticket,
          { kind: 'macro', itemId: templateId },
          editLeaseId,
          expectedRevision,
          (_path, currentRevision) => macroStore.commitDelete(templateId, currentRevision),
          { deleteRecord: true },
        )
      ))
      manager.broadcastAllClients(() => ({
        type: 'content_record_changed',
        resourceKey: { kind: 'macro', itemId: templateId },
        operation: 'deleted',
        revision: null,
      }))
      return json({ ok: true, leaseOutcome: committed.leaseOutcome })
    }
    return methodNotAllowed(['GET', 'PUT', 'DELETE'])
  }

  const contentLeaseRelease = /^\/api\/content-edit-leases\/([^/]+)$/.exec(url.pathname)
  if (contentLeaseRelease) {
    assertNoQuery(url)
    if (req.method !== 'DELETE') return methodNotAllowed(['DELETE'])
    await exactObject(req, [])
    const editLeaseId = assertGeneratedId(decodeURIComponent(contentLeaseRelease[1]), 'contentEditLease')
    const view = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await contentEditLeases.release(ticket, editLeaseId)
    ))
    return json({ ok: true, view })
  }

  if (url.pathname === '/api/notification-profiles/telegram') {
    if (req.method !== 'GET') return methodNotAllowed(['GET'])
    assertNoQuery(url)
    return json({ ok: true, profiles: notificationService.listTelegramProfileIds() })
  }

  if (url.pathname === '/api/macro/profile-catalog') {
    if (req.method !== 'GET') return methodNotAllowed(['GET'])
    assertNoQuery(url)
    return json({ ok: true, profileCatalog: PROFILE_CATALOG_SUMMARY })
  }

  return null
}

function validateLibraryMacroContent(kind: LibraryItemKind, content: string): Response | null {
  if (kind !== 'macro-template') return null
  const validation = parseAndValidateMacroDefinitionJson(content)
  return validation.ok ? null : macroValidationResponse(validation.error)
}

function macroValidationResponse(error: Exclude<ReturnType<typeof parseAndValidateMacroDefinitionJson>, { ok: true }>['error']): Response {
  return error.code === 'invalid_json'
    ? json({ ok: false, error: error.code, offset: error.offset, line: error.line, column: error.column, message: error.message }, 400)
    : json({ ok: false, error: error.code, issues: error.issues }, 400)
}

function broadcastLibraryChange(manager: TerminalRoomManager, kind: LibraryItemKind, itemId: string, operation: 'saved' | 'deleted', revision: number | null): void {
  manager.broadcastAllClients(() => ({
    type: 'content_record_changed',
    resourceKey: { kind: 'library', itemKind: kind, itemId },
    operation,
    revision,
  }))
}

function countMacroNodes(nodes: FlowV2Node[]): number {
  let count = 0
  const visit = (items: FlowV2Node[]) => {
    for (const node of items) {
      count += 1
      if (node.type === 'if') {
        for (const branch of node.branches) visit(branch.body)
        if (node.else) visit(node.else)
      }
      if (node.type === 'for') visit(node.body)
      if (node.type === 'parallel') for (const lane of node.lanes) count += lane.body.length
      if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) visit(node.body)
    }
  }
  visit(nodes)
  return count
}
