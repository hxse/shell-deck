import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
export const ACCESS_MODES = ['guest', 'authenticated'] as const
export const LISTEN_MODES = ['local', 'lan'] as const
export type AccessMode = typeof ACCESS_MODES[number]
export type ListenMode = typeof LISTEN_MODES[number]
const SESSION_COOKIE = 'shell_deck_session'
const SESSION_MAX_AGE_SECONDS = 2_592_000
export class ServerAccessController {
  readonly loginToken: string | null
  readonly #sessions = new Set<string>()
  readonly #allowedHosts: Set<string>
  constructor(readonly accessMode: AccessMode, listenMode: ListenMode, private readonly devFrontendPort?: number) {
    assertAccessMode(accessMode)
    assertListenMode(listenMode)
    if (devFrontendPort !== undefined && (!Number.isInteger(devFrontendPort) || devFrontendPort < 1 || devFrontendPort > 65_535)) {
      throw new Error('invalid_dev_frontend_port')
    }
    this.loginToken = accessMode === 'authenticated' ? randomBytes(24).toString('base64url') : null
    this.#allowedHosts = new Set(serverHostAllowlist(listenMode))
  }
  async admit(req: Request, url: URL): Promise<Response | null> {
    if (!this.#sameBrowserOrigin(req, url)) return failure('browser_origin_forbidden', 403, url)
    if (this.accessMode === 'guest') return null
    if (url.pathname === '/login') return await this.#login(req, url)
    if (isIngestRequest(req, url) || this.#hasSession(req)) return null
    if (isHtmlNavigation(req, url)) {
      const next = url.pathname + url.search
      return new Response(null, { status: 302,
        headers: { location: '/login?next=' + encodeURIComponent(next), 'cache-control': 'no-store' } })
    }
    return failure('authentication_required', 401, url)
  }
  #sameBrowserOrigin(req: Request, url: URL): boolean {
    if (req.headers.get('sec-fetch-site') === 'cross-site') return false
    if (!this.#allowedHosts.has(normalizeHost(url.hostname))) return false
    const host = req.headers.get('host')
    if (host && host.toLowerCase() !== url.host.toLowerCase()) return false
    const value = req.headers.get('origin')
    if (!value) return true
    let origin: URL
    try { origin = new URL(value) } catch { return false }
    if (origin.origin === url.origin) return true
    return this.devFrontendPort !== undefined
      && origin.protocol === url.protocol
      && normalizeHost(origin.hostname) === normalizeHost(url.hostname)
      && effectivePort(origin) === String(this.devFrontendPort)
  }
  async #login(req: Request, url: URL): Promise<Response> {
    if (req.method === 'GET') {
      const next = loginNext(url.searchParams)
      return next ? loginPage(next) : failure('invalid_login_request', 400, url)
    }
    if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405, headers: { allow: 'GET, POST' } })
    if ([...url.searchParams].length !== 0
      || !req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return failure('invalid_login_request', 400, url)
    const form = new URLSearchParams(await req.text())
    if ([...form.keys()].sort().join(',') !== 'next,token'
      || form.getAll('next').length !== 1 || form.getAll('token').length !== 1) return failure('invalid_login_request', 400, url)
    const next = localNext(form.get('next')!)
    if (!next) return failure('invalid_login_request', 400, url)
    const candidate = digest(form.get('token')!)
    if (!this.loginToken || !timingSafeEqual(candidate, digest(this.loginToken))) return loginPage(next, true)
    const session = randomBytes(24).toString('base64url')
    this.#sessions.add(session)
    const cookie = [SESSION_COOKIE + '=' + session, 'HttpOnly', 'SameSite=Strict', 'Path=/',
      'Max-Age=' + SESSION_MAX_AGE_SECONDS,
      ...(url.protocol === 'https:' ? ['Secure'] : []),
    ].join('; ')
    return new Response(null, { status: 303,
      headers: { location: next, 'set-cookie': cookie, 'cache-control': 'no-store' } })
  }
  #hasSession(req: Request): boolean {
    const cookie = req.headers.get('cookie')
    if (!cookie) return false
    for (const part of cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=')
      if (name === SESSION_COOKIE && this.#sessions.has(rest.join('='))) return true
    }
    return false
  }
}
export function assertAccessMode(value: unknown): AccessMode {
  if (value !== 'guest' && value !== 'authenticated') throw new Error('invalid_server_access_mode')
  return value
}
export function assertListenMode(value: unknown): ListenMode {
  if (value !== 'local' && value !== 'lan') throw new Error('invalid_server_listen_mode')
  return value
}
export function listenHost(mode: ListenMode): '127.0.0.1' | '0.0.0.0' {
  return assertListenMode(mode) === 'local' ? '127.0.0.1' : '0.0.0.0'
}
export function serverHostAllowlist(mode: ListenMode): string[] {
  const hosts = ['localhost', '127.0.0.1', '::1']
  if (assertListenMode(mode) === 'lan') {
    const machine = normalizeHost(hostname())
    hosts.push(machine, machine + '.local')
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) hosts.push(normalizeHost(entry.address))
  }
  return hosts
}
function digest(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest() }
function effectivePort(url: URL): string { return url.port || (url.protocol === 'https:' ? '443' : '80') }
function normalizeHost(value: string): string { return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '') }
function isHtmlNavigation(req: Request, url: URL): boolean {
  if (isCapabilityRoute(url.pathname) || url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') return false
  return req.method === 'GET'
    && (req.headers.get('sec-fetch-mode') === 'navigate' || req.headers.get('accept')?.includes('text/html') === true)
}
function isIngestRequest(req: Request, url: URL): boolean {
  return req.headers.has('x-shell-deck-ingest-token')
    && /^\/api\/rooms\/[^/]+\/(agent-events|structured-results)$/.test(url.pathname)
}
function loginNext(params: URLSearchParams): string | null {
  if ([...params.keys()].some((key) => key !== 'next') || params.getAll('next').length > 1) return null
  return localNext(params.get('next') ?? '/')
}
function localNext(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}
function loginPage(next: string, rejected = false): Response {
  const message = rejected ? '<p>Invalid token.</p>' : ''
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<title>shell-deck login</title><h1>shell-deck</h1>' + message
    + '<form method="post" action="/login"><label>Server token <input name="token" type="password" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required autofocus></label>'
    + '<input name="next" type="hidden" value="' + escapeHtml(next) + '"><button type="submit">Log in</button></form>'
  return new Response(html, { status: rejected ? 401 : 200, headers: htmlHeaders() })
}
function failure(error: string, status: number, url: URL): Response {
  if (isCapabilityRoute(url.pathname)) {
    return new Response(JSON.stringify({ ok: false, error }), { status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  }
  return new Response(error, { status, headers: { 'cache-control': 'no-store' } })
}
function htmlHeaders(): Record<string, string> {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff' }
}
function isCapabilityRoute(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname.startsWith('/ws/')
}
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') }
