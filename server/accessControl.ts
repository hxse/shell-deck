import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { LOGIN_QR_ASSET_PATH, LOGIN_STYLE_ASSET_PATH, LOGIN_TOKEN_BYTES } from '../src/lib/loginToken'
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
    this.loginToken = accessMode === 'authenticated' ? randomBytes(LOGIN_TOKEN_BYTES).toString('base64url') : null
    this.#allowedHosts = new Set(serverHostAllowlist(listenMode))
  }
  async admit(req: Request, url: URL): Promise<Response | null> {
    if (!this.#sameBrowserOrigin(req, url)) return failure('browser_origin_forbidden', 403, url)
    if (this.accessMode === 'guest') return null
    if (url.pathname === '/login') return await this.#login(req, url)
    if (isPublicLoginAsset(req, url)) return null
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
function isPublicLoginAsset(req: Request, url: URL): boolean {
  return req.method === 'GET'
    && (url.pathname === LOGIN_QR_ASSET_PATH || url.pathname === LOGIN_STYLE_ASSET_PATH)
    && [...url.searchParams].length === 0
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
  const message = rejected
    ? '<div class="alert alert-error items-start text-sm shadow-sm" role="alert">'
      + alertIcon()
      + '<div><strong class="block font-semibold">Token rejected</strong>'
      + '<span>The server token did not match. Check it and try again.</span></div></div>'
    : ''
  const html = '<!doctype html><html lang="en" data-theme="business"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>shell-deck login</title>'
    + '<link rel="stylesheet" href="' + LOGIN_STYLE_ASSET_PATH + '"></head>'
    + '<body class="min-h-screen overflow-x-hidden bg-base-300 font-sans text-base-content antialiased">'
    + '<main class="relative grid min-h-screen place-items-center px-4 py-8 sm:px-6">'
    + '<div class="pointer-events-none absolute -top-28 -left-24 size-80 rounded-full bg-primary/15 blur-3xl" aria-hidden="true"></div>'
    + '<div class="pointer-events-none absolute -right-24 -bottom-32 size-96 rounded-full bg-secondary/15 blur-3xl" aria-hidden="true"></div>'
    + '<section class="card relative z-10 w-full max-w-lg bg-base-100 shadow-2xl">'
    + '<div class="card-body gap-5 p-6 sm:p-8">'
    + '<header class="grid gap-4">'
    + '<div class="flex items-center gap-3"><div class="grid size-11 shrink-0 place-items-center rounded-box bg-primary text-primary-content shadow-lg">'
    + terminalIcon() + '</div><div class="min-w-0"><span class="badge badge-primary badge-soft mb-1">Authenticated server</span>'
    + '<h1 class="m-0 font-mono text-2xl font-bold tracking-tight">shell-deck</h1></div></div>'
    + '<p class="m-0 text-sm leading-relaxed text-base-content/65">Unlock this server with the temporary token shown in its terminal.</p>'
    + '</header>' + message
    + '<form id="login-form" class="grid gap-4" method="post" action="/login">'
    + '<div id="login-qr-status-shell" class="toast toast-top toast-center z-50 hidden w-full max-w-lg px-3">'
    + '<p id="login-qr-status" class="alert m-0 min-h-11 py-2 text-sm shadow-xl" role="status" aria-live="polite" aria-atomic="true"></p></div>'
    + '<fieldset class="fieldset gap-2 p-0"><legend class="fieldset-legend text-base-content">Server token</legend>'
    + '<input id="login-token" class="input input-lg box-border w-full bg-base-content/15 font-mono tracking-wide" name="token" type="password"'
    + ' autocomplete="one-time-code" autocapitalize="none" spellcheck="false" aria-describedby="login-token-help login-qr-status"'
    + ' placeholder="Paste the 32-character token" required autofocus>'
    + '<p id="login-token-help" class="m-0 text-xs leading-relaxed text-base-content/50">A new token is generated whenever the server starts.</p></fieldset>'
    + '<div class="divider my-0 text-[11px] tracking-[0.16em] text-base-content/40">OR SCAN THE QR</div>'
    + '<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">'
    + '<div id="upload-login-qr" class="grid gap-1"><span class="text-xs font-semibold text-base-content/70">Upload QR image</span>'
    + '<input id="login-qr-file" class="file-input file-input-ghost file-input-secondary file-input-md box-border w-full" type="file" accept="image/*" aria-label="Upload QR image" aria-controls="login-qr-status"></div>'
    + '<div id="take-login-qr-photo" class="hidden grid gap-1"><span class="text-xs font-semibold text-base-content/70">Take QR photo</span>'
    + '<input id="login-qr-capture-file" class="file-input file-input-ghost file-input-secondary file-input-md box-border w-full" type="file" accept="image/*" capture="environment" aria-label="Take QR photo" aria-controls="login-qr-status"></div>'
    + '<div class="grid gap-1"><span class="text-xs font-semibold text-base-content/70">Live QR camera</span>'
    + '<button id="scan-login-qr-live" class="btn btn-secondary btn-md w-full whitespace-nowrap" type="button" aria-controls="login-qr-camera-dialog login-qr-status">'
    + cameraIcon() + '<span>Scan with camera</span></button></div></div>'
    + '<p class="m-0 text-xs leading-relaxed text-base-content/50">For a photo, keep the whole QR and its white border visible and avoid screen glare.</p>'
    + '<details id="login-debug-shell" class="hidden rounded-box border border-base-300 bg-base-200 p-3">'
    + '<summary class="cursor-pointer text-sm font-semibold">Login diagnostics</summary>'
    + '<div class="grid gap-3 pt-3"><p class="m-0 text-xs leading-relaxed text-base-content/60">'
    + 'This tab-local log excludes tokens, file names and image pixels. It survives login-page reloads.</p>'
    + '<textarea id="login-debug-output" class="textarea h-48 w-full resize-y font-mono text-xs" readonly aria-label="Login debug log"></textarea>'
    + '<div class="flex flex-wrap items-center gap-2"><button id="copy-login-debug" class="btn btn-sm btn-secondary" type="button">Copy debug log</button>'
    + '<button id="select-login-debug" class="btn btn-sm btn-ghost" type="button">Select all</button>'
    + '<button id="clear-login-debug" class="btn btn-sm btn-ghost" type="button">Clear</button>'
    + '<span id="login-debug-status" class="text-xs text-base-content/60" role="status" aria-live="polite"></span></div></div></details>'
    + '<input name="next" type="hidden" value="' + escapeHtml(next) + '">'
    + '<button class="btn btn-primary mt-1 min-h-12 w-full text-base" type="submit">Log in' + arrowIcon() + '</button>'
    + '<dialog id="login-qr-camera-dialog" class="modal" aria-labelledby="login-qr-camera-title" aria-describedby="login-qr-camera-help">'
    + '<div class="modal-box grid max-w-lg gap-4 bg-base-100 p-5 sm:p-6">'
    + '<div><span class="badge badge-primary badge-soft mb-2">Live scanner</span>'
    + '<h2 id="login-qr-camera-title" class="m-0 text-xl font-bold">Scan login QR</h2>'
    + '<p id="login-qr-camera-help" class="mt-2 mb-0 text-sm leading-relaxed text-base-content/65">'
    + 'Point this device at the QR code shown in the shell-deck terminal.</p></div>'
    + '<div class="relative overflow-hidden rounded-box bg-neutral shadow-inner">'
    + '<video id="login-qr-camera-video" class="aspect-video w-full object-cover" width="320" height="240"'
    + ' aria-label="Live camera preview" autoplay muted playsinline></video>'
    + '<span class="badge badge-neutral absolute top-3 left-3 shadow">Scanning</span></div>'
    + '<p id="login-qr-camera-status" class="alert empty:hidden m-0 min-h-11 py-2 text-sm shadow-sm" role="status" aria-live="polite" aria-atomic="true"></p>'
    + '<div class="modal-action mt-0"><button id="close-login-qr-camera" class="btn btn-ghost" type="button">Cancel camera</button></div>'
    + '</div></dialog></form>'
    + '<footer class="flex items-center justify-center gap-2 text-center text-xs text-base-content/45">'
    + shieldIcon() + '<span>The token is exchanged only with this server.</span></footer>'
    + '</div></section></main><script type="module" src="' + LOGIN_QR_ASSET_PATH + '"></script></body></html>'
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
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff' }
}
function isCapabilityRoute(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname.startsWith('/ws/')
}
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') }
function icon(paths: string): string {
  return '<svg aria-hidden="true" class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>'
}
function terminalIcon(): string {
  return icon('<path d="m7 8 4 4-4 4"/><path d="M13 16h4"/>')
}
function cameraIcon(): string {
  return icon('<path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z"/>'
    + '<circle cx="12" cy="13" r="3"/>')
}
function arrowIcon(): string {
  return icon('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>')
}
function shieldIcon(): string {
  return icon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>')
}
function alertIcon(): string {
  return icon('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>')
}
