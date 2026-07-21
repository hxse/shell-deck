import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { handleContentRoutes } from '../../server/http/contentRoutes'
import type { HttpContext } from '../../server/http/httpContext'
import { errorResponse, exactObject, json, methodNotAllowed } from '../../server/http/httpPrimitives'
import { handlePageRoutes } from '../../server/http/pageRoutes'
import { handleRoomRoutes } from '../../server/http/roomRoutes'
import { handleRunnerRoutes } from '../../server/http/runnerRoutes'

test('HTTP primitives preserve serialized response bytes, headers and validation errors', async () => {
  const success = json({ ok: true, value: '雪' }, 201)
  expect(success.status).toBe(201)
  expect(success.headers.get('content-type')).toBe('application/json; charset=utf-8')
  expect(success.headers.get('cache-control')).toBe('no-store')
  expect(await success.text()).toBe('{"ok":true,"value":"雪"}')

  const rejectedMethod = methodNotAllowed(['GET', 'POST'])
  expect(rejectedMethod.status).toBe(405)
  expect(rejectedMethod.headers.get('allow')).toBe('GET, POST')
  expect(await rejectedMethod.text()).toBe('method_not_allowed')

  await expect(exactObject(new Request('http://shell-deck.test', { method: 'POST', body: '{' }), [])).rejects.toThrow('invalid_request_json')
  await expect(exactObject(new Request('http://shell-deck.test', { method: 'POST', body: '{"legacy":true}' }), [])).rejects.toThrow('request_unknown_field:legacy')

  const apiError = errorResponse(new Error('room_not_found'), true)
  expect(apiError.status).toBe(404)
  expect(await apiError.text()).toBe('{"ok":false,"error":"room_not_found"}')
  const pageError = errorResponse(new Error('<missing>'), false)
  expect(pageError.status).toBe(404)
  expect(await pageError.text()).toContain('<p>&lt;missing&gt;</p>')
})

test('route groups explicitly decline unrelated paths and composition order stays visible', async () => {
  const request = new Request('http://shell-deck.test/not-a-route')
  const url = new URL(request.url)
  const context = {} as HttpContext
  expect(await handleRoomRoutes(request, url, context)).toBeNull()
  expect(await handleContentRoutes(request, url, context)).toBeNull()
  expect(await handleRunnerRoutes(request, url, context)).toBeNull()
  expect(handlePageRoutes(new Request('http://shell-deck.test/api/not-a-route'), new URL('http://shell-deck.test/api/not-a-route'), context)).toBeNull()

  const source = readFileSync(resolve(import.meta.dir, '../../server/httpServer.ts'), 'utf8')
  const routeOrder = [
    'handleRoomRoutes(req, url, httpContext)',
    'handleContentRoutes(req, url, httpContext)',
    'handleRunnerRoutes(req, url, httpContext)',
    "url.pathname.startsWith('/api/')",
    'handlePageRoutes(req, url, httpContext)',
  ].map((needle) => source.indexOf(needle))
  expect(routeOrder.every((position) => position >= 0)).toBe(true)
  expect(routeOrder).toEqual([...routeOrder].sort((left, right) => left - right))
})
