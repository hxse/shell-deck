import type { ContentCommitLeaseOutcome, ContentEditLeaseGrant } from '../contentEditLease'
import type { RoomControlGrant } from '../roomControl'
import { roomControlHeaders } from '../roomControl'
import type { MacroRecord } from '../macro/macroDefinitionTypes'
import type { LibraryItem, LibraryItemFields, LibraryItemKind, LibraryItemListResult } from './libraryTypes'

export class LibraryClient {
  constructor(private readonly controlGrant: () => RoomControlGrant | null) {}

  async list(kind: LibraryItemKind, query = ''): Promise<LibraryItemListResult> {
    const params = new URLSearchParams({ kind })
    if (query.length > 0) params.set('q', query)
    const response = await requestJson('/api/library/items?' + params)
    return {
      items: response.items as LibraryItemListResult['items'],
      invalidItems: response.invalidItems as LibraryItemListResult['invalidItems'],
    }
  }

  async read(kind: LibraryItemKind, itemId: string): Promise<LibraryItem> {
    return (await requestJson(itemPath(kind, itemId))).item as LibraryItem
  }

  async create(kind: LibraryItemKind, fields: LibraryItemFields): Promise<LibraryItem> {
    return (await requestJson('/api/library/items', {
      method: 'POST',
      headers: this.controlHeaders(),
      body: JSON.stringify({ kind, ...fields }),
    })).item as LibraryItem
  }

  async update(item: LibraryItem, fields: LibraryItemFields, lease: ContentEditLeaseGrant): Promise<{ item: LibraryItem; leaseOutcome: ContentCommitLeaseOutcome }> {
    const response = await requestJson(itemPath(item.kind, item.itemId), {
      method: 'PUT',
      headers: this.controlHeaders(),
      body: JSON.stringify({ ...fields, expectedRevision: item.revision, editLeaseId: lease.editLeaseId }),
    })
    return { item: response.item as LibraryItem, leaseOutcome: response.leaseOutcome as ContentCommitLeaseOutcome }
  }

  async delete(item: LibraryItem, lease: ContentEditLeaseGrant): Promise<ContentCommitLeaseOutcome> {
    const response = await requestJson(itemPath(item.kind, item.itemId), {
      method: 'DELETE',
      headers: {
        ...this.controlHeaders(),
        'If-Match': String(item.revision),
        'X-Shell-Deck-Content-Edit-Lease': lease.editLeaseId,
      },
    })
    return response.leaseOutcome as ContentCommitLeaseOutcome
  }

  async loadIntoMacro(item: LibraryItem): Promise<MacroRecord> {
    return (await requestJson('/api/templates/from-library', {
      method: 'POST',
      headers: this.controlHeaders(),
      body: JSON.stringify({ itemId: item.itemId, expectedRevision: item.revision }),
    })).template as MacroRecord
  }

  private controlHeaders(): Record<string, string> {
    const grant = this.controlGrant()
    if (!grant) throw new Error('room_control_required')
    return { 'content-type': 'application/json', ...roomControlHeaders(grant) }
  }
}

function itemPath(kind: LibraryItemKind, itemId: string): string {
  return '/api/library/items/' + encodeURIComponent(kind) + '/' + encodeURIComponent(itemId)
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const value = await response.json() as Record<string, unknown>
  if (!response.ok || value.ok !== true) {
    const error = new Error(typeof value.error === 'string' ? value.error : 'library_request_failed')
    Object.assign(error, { response: value, status: response.status })
    throw error
  }
  return value
}
