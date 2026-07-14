import type { ContentCommitLeaseOutcome, ContentEditLeaseGrant } from '../contentEditLease'
import type { RoomControlGrant } from '../roomControl'
import { ROOM_CONTROL_CLIENT_HEADER, ROOM_CONTROL_EPOCH_HEADER, ROOM_CONTROL_LEASE_HEADER } from '../roomControl'
import type { MacroDefinitionV3, MacroRecord, MacroRecordSummary } from './macroDefinitionTypes'

export const CONTENT_EDIT_LEASE_HEADER = 'X-Shell-Deck-Content-Edit-Lease'

export class MacroRecordClient {
  constructor(private readonly controlGrant: () => RoomControlGrant | null) {}

  async list(): Promise<MacroRecordSummary[]> {
    return (await requestJson('/api/templates')).templates as MacroRecordSummary[]
  }

  async read(id: string): Promise<MacroRecord> {
    return (await requestJson('/api/templates/' + encodeURIComponent(id))).template as MacroRecord
  }

  async create(definition: MacroDefinitionV3): Promise<MacroRecord> {
    return (await requestJson('/api/templates', { method: 'POST', headers: this.controlHeaders(), body: JSON.stringify({ definition }) })).template as MacroRecord
  }

  async update(record: MacroRecord, definition: MacroDefinitionV3, lease: ContentEditLeaseGrant): Promise<{ record: MacroRecord; leaseOutcome: ContentCommitLeaseOutcome }> {
    const response = await requestJson('/api/templates/' + encodeURIComponent(record.id), {
      method: 'PUT',
      headers: this.controlHeaders(),
      body: JSON.stringify({ expectedRevision: record.revision, editLeaseId: lease.editLeaseId, definition }),
    })
    return { record: response.template as MacroRecord, leaseOutcome: response.leaseOutcome as ContentCommitLeaseOutcome }
  }

  async delete(record: MacroRecord, lease: ContentEditLeaseGrant): Promise<ContentCommitLeaseOutcome> {
    const response = await requestJson('/api/templates/' + encodeURIComponent(record.id), {
      method: 'DELETE',
      headers: { ...this.controlHeaders(), 'If-Match': String(record.revision), [CONTENT_EDIT_LEASE_HEADER]: lease.editLeaseId },
    })
    return response.leaseOutcome as ContentCommitLeaseOutcome
  }

  private controlHeaders(): Record<string, string> {
    const grant = this.controlGrant()
    if (!grant) throw new Error('room_control_required')
    return {
      'content-type': 'application/json',
      [ROOM_CONTROL_CLIENT_HEADER]: grant.clientId,
      [ROOM_CONTROL_LEASE_HEADER]: grant.controlLeaseId,
      [ROOM_CONTROL_EPOCH_HEADER]: String(grant.controlEpoch),
    }
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const value = await response.json() as Record<string, unknown>
  if (!response.ok || value.ok !== true) {
    const error = new Error(typeof value.error === 'string' ? value.error : 'macro_request_failed')
    Object.assign(error, { response: value, status: response.status })
    throw error
  }
  return value
}
