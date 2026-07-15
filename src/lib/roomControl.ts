import { assertGeneratedId } from './generatedId'

export const ROOM_CONTROL_CLIENT_HEADER = 'x-shell-deck-client-id'
export const ROOM_CONTROL_LEASE_HEADER = 'x-shell-deck-room-control-lease'
export const ROOM_CONTROL_EPOCH_HEADER = 'x-shell-deck-room-control-epoch'

export type RoomControlView =
  | { mode: 'available'; controlEpoch: number }
  | { mode: 'observer'; controlEpoch: number; expiresAt: string }
  | { mode: 'controller'; controlEpoch: number; expiresAt: string }

export type RoomControlGrant = {
  clientId: string
  controlLeaseId: string
  controlEpoch: number
  expiresAt: string
}

export type RoomControlBearer = {
  clientId: string
  controlLeaseId: string
  controlEpoch: number
}

export type RoomControlContext = RoomControlBearer & {
  serverInstanceId: string
  roomId: string
  roomGeneration: string
}

export function assertControlEpoch(value: unknown, error = 'invalid_control_epoch'): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(error)
  return value as number
}

export function assertRoomControlBearer(value: RoomControlBearer): RoomControlBearer {
  return {
    clientId: assertGeneratedId(value.clientId, 'client'),
    controlLeaseId: assertGeneratedId(value.controlLeaseId, 'roomControlLease'),
    controlEpoch: assertControlEpoch(value.controlEpoch),
  }
}

export function roomControlHeaders(grant: RoomControlGrant): Record<string, string> {
  return {
    [ROOM_CONTROL_CLIENT_HEADER]: assertGeneratedId(grant.clientId, 'client'),
    [ROOM_CONTROL_LEASE_HEADER]: assertGeneratedId(grant.controlLeaseId, 'roomControlLease'),
    [ROOM_CONTROL_EPOCH_HEADER]: String(assertControlEpoch(grant.controlEpoch)),
  }
}
