import { assertRoomRouteToken } from '../../src/lib/generatedId'
import { agentEventTokenFromRequest, ingestAgentEvent } from '../agentEventIngest'
import type { HttpContext, HttpRouteResult } from './httpContext'
import {
  assertNoQuery,
  exactObject,
  json,
  methodNotAllowed,
  requestJson,
  roomControlBearer,
  roomControlClientId,
} from './httpPrimitives'

export async function handleRoomRoutes(req: Request, url: URL, context: HttpContext): Promise<HttpRouteResult> {
  const { agentEventStore, ingestToken, manager } = context

  if (url.pathname === '/health') {
    assertNoQuery(url)
    return json({ ok: true, serverInstanceId: manager.serverInstanceId })
  }

  if (url.pathname === '/api/rooms') {
    assertNoQuery(url)
    if (req.method === 'GET') return json({ ok: true, rooms: manager.listRooms(), maxLiveRooms: manager.maxLiveRooms })
    if (req.method === 'POST') {
      if ((await req.text()).length !== 0) throw new Error('room_create_body_must_be_empty')
      const room = manager.createRoom()
      return json({ ok: true, room, url: '/' + room.roomId }, 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const roomControlAcquire = /^\/api\/rooms\/([^/]+)\/control\/acquire$/.exec(url.pathname)
  if (roomControlAcquire) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(roomControlAcquire[1]))
    const body = await exactObject(req, ['expectedControlEpoch'])
    const clientId = roomControlClientId(req)
    manager.roomControlView(roomId, clientId)
    const grant = manager.acquireRoomControl(clientId, body.expectedControlEpoch as number)
    return json({ ok: true, view: manager.roomControlView(roomId, clientId), grant })
  }

  const roomControlTakeOver = /^\/api\/rooms\/([^/]+)\/control\/take-over$/.exec(url.pathname)
  if (roomControlTakeOver) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(roomControlTakeOver[1]))
    const body = await exactObject(req, ['expectedControlEpoch', 'confirmed'])
    const clientId = roomControlClientId(req)
    manager.roomControlView(roomId, clientId)
    const grant = await manager.takeOverRoomControl(clientId, body.expectedControlEpoch as number, body.confirmed === true)
    return json({ ok: true, view: manager.roomControlView(roomId, clientId), grant })
  }

  const roomControlRelease = /^\/api\/rooms\/([^/]+)\/control$/.exec(url.pathname)
  if (roomControlRelease) {
    assertNoQuery(url)
    if (req.method !== 'DELETE') return methodNotAllowed(['DELETE'])
    const roomId = assertRoomRouteToken(decodeURIComponent(roomControlRelease[1]))
    await exactObject(req, [])
    await manager.releaseRoomControl(roomControlBearer(req), roomId)
    return json({ ok: true })
  }

  const roomApi = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname)
  if (roomApi) {
    assertNoQuery(url)
    const roomId = assertRoomRouteToken(decodeURIComponent(roomApi[1]))
    if (req.method !== 'DELETE') return methodNotAllowed(['DELETE'])
    const body = await exactObject(req, ['expectedRoomGeneration'])
    if (typeof body.expectedRoomGeneration !== 'string') throw new Error('expected_room_generation_required')
    await manager.destroyRoom(roomId, body.expectedRoomGeneration)
    return json({ ok: true })
  }

  const ingest = /^\/api\/rooms\/([^/]+)\/agent-events$/.exec(url.pathname)
  if (ingest) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(ingest[1]))
    const result = ingestAgentEvent(await requestJson(req), agentEventTokenFromRequest(req), {
      roomId,
      expectedToken: ingestToken,
      manager,
      store: agentEventStore,
    })
    return result.ok ? json({ ok: true, event: result.event }, 201) : json(result, result.status)
  }

  return null
}
