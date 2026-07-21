import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { assertRoomRouteToken } from '../../src/lib/generatedId'
import type { HttpContext, HttpRouteResult } from './httpContext'
import { assertNoQuery, methodNotAllowed, notFoundPage } from './httpPrimitives'

export function handlePageRoutes(req: Request, url: URL, context: HttpContext): HttpRouteResult {
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return null

  const asset = req.method === 'GET' ? serveStaticAsset(url.pathname) : null
  if (asset) return asset
  if (req.method !== 'GET') return methodNotAllowed(['GET'])

  if (url.pathname === '/') {
    assertNoQuery(url)
    const entry = context.manager.ensureRootRoom()
    if (entry.kind === 'created') {
      return new Response(null, {
        status: 302,
        headers: { location: '/' + entry.room.roomId, 'cache-control': 'no-store, private' },
      })
    }
    return serveIndex()
  }

  if (!/^\/[^/]+$/.test(url.pathname)) return notFoundPage('route_not_found')
  assertNoQuery(url)
  const roomId = assertRoomRouteToken(decodeURIComponent(url.pathname.slice(1)))
  context.manager.ensureRoomFromRoute(roomId)
  return serveIndex()
}

function serveStaticAsset(pathname: string): Response | null {
  if (!pathname.startsWith('/assets/') && pathname !== '/favicon.ico') return null
  const dist = resolve(import.meta.dir, '..', '..', 'dist')
  const target = resolve(dist, '.' + pathname)
  if (!target.startsWith(dist + '/') || !existsSync(target)) return null
  return new Response(Bun.file(target), { headers: { 'content-type': contentType(target) } })
}

function serveIndex(): Response {
  const built = resolve(import.meta.dir, '..', '..', 'dist', 'index.html')
  const fallback = resolve(import.meta.dir, '..', '..', 'index.html')
  const path = existsSync(built) ? built : fallback
  if (!existsSync(path)) return new Response('shell-deck', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new Response(readFileSync(path), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.ico': return 'image/x-icon'
    default: return 'application/octet-stream'
  }
}
