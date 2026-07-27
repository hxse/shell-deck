import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { ServerAccessController } from '../../server/accessControl'
import { startShellDeckServer } from '../../server/httpServer'
import { LOGIN_QR_ASSET_PATH, LOGIN_STYLE_ASSET_PATH } from '../../src/lib/loginToken'
test('authenticated mode gates navigation, API and websocket before Room mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-access-20260726a-'))
  const server = startShellDeckServer({ accessMode: 'authenticated', listenMode: 'local', port: 0, dataRoot: root })
  try {
    expect(server.loginToken?.length).toBeGreaterThanOrEqual(22)
    const navigation = await fetch(server.url + '/', { headers: { accept: 'text/html' }, redirect: 'manual' })
    expect(navigation.status).toBe(302); expect(navigation.headers.get('location')).toBe('/login?next=%2F')
    const loginPage = await fetch(server.url + '/login')
    expect(loginPage.headers.get('referrer-policy')).toBe('same-origin')
    expect(loginPage.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(loginPage.headers.get('content-security-policy')).toContain("style-src 'self'")
    const loginHtml = await loginPage.text()
    expect(loginHtml).toContain('<html lang="en" data-theme="business">')
    expect(loginHtml).toContain('class="card relative')
    expect(loginHtml).toContain('class="input input-lg')
    expect(loginHtml).toContain('href="' + LOGIN_STYLE_ASSET_PATH + '"')
    expect(loginHtml).toContain('<div id="upload-login-qr"')
    expect(loginHtml).toContain('id="login-qr-file" class="file-input file-input-ghost file-input-secondary file-input-md')
    expect(loginHtml).toContain('type="file" accept="image/*" aria-label="Upload QR image"')
    expect(loginHtml).toContain('id="login-qr-capture-file" class="file-input file-input-ghost')
    expect(loginHtml).toContain('accept="image/*" capture="environment" aria-label="Take QR photo"')
    expect(loginHtml).toContain('id="scan-login-qr-live" class="btn btn-secondary btn-md')
    expect(loginHtml).toContain('id="login-qr-status-shell"')
    expect(loginHtml).toContain('id="login-qr-camera-dialog"')
    expect(loginHtml).toContain('id="login-qr-camera-video"')
    expect(loginHtml).toContain('id="login-qr-camera-status"')
    expect(loginHtml).toContain('id="login-debug-shell"')
    expect(loginHtml).toContain('id="login-debug-output"')
    expect(loginHtml).toContain('id="copy-login-debug"')
    expect(loginHtml).toContain('id="select-login-debug"')
    expect(loginHtml).toContain('id="clear-login-debug"')
    expect(loginHtml).toContain('src="' + LOGIN_QR_ASSET_PATH + '"')
    expect((await fetch(server.url + '/api/rooms', { headers: { accept: 'text/html' } })).status).toBe(401)
    expect((await fetch(server.url + '/assets/missing.js', { headers: { accept: 'text/html' } })).status).toBe(401)
    expect((await fetch(server.url + '/ws/rooms/room_invalid')).status).toBe(401)
    const denied = await fetch(server.url + '/api/rooms', { method: 'POST',
      headers: { origin: 'http://attacker.invalid', 'sec-fetch-site': 'cross-site' },
    })
    expect(denied.status).toBe(403)
    expect(server.manager.listRooms()).toEqual([])
    const invalidNext = await login(server.url, server.loginToken!, '//attacker.invalid')
    expect(invalidNext.status).toBe(400)
    const wrong = await login(server.url, 'wrong', '/')
    expect(wrong.status).toBe(401)
    const accepted = await fetch(server.url + '/login', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: server.loginToken!, next: '/' }), redirect: 'manual',
    })
    expect(accepted.status).toBe(303); expect(accepted.headers.get('location')).toBe('/')
    expect(accepted.url).not.toContain(server.loginToken!)
    const setCookie = accepted.headers.get('set-cookie')!
    expect(setCookie).toContain('HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000')
    const cookie = setCookie.split(';', 1)[0]
    expect((await fetch(server.url + '/api/rooms', { headers: { cookie } })).status).toBe(200)
    expect((await fetch(server.url + '/ws/rooms/room_invalid', { headers: { cookie } })).status).toBe(404)
    const second = startShellDeckServer({ accessMode: 'authenticated', listenMode: 'lan', port: 0, dataRoot: root })
    try { expect((await fetch(second.url + '/api/rooms', { headers: { cookie, origin: second.url } })).status).toBe(401) }
    finally { await second.stop() }
    const room = server.manager.createRoom()
    const hook = await fetch(server.url + '/api/rooms/' + room.roomId + '/structured-results', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-ingest-token': 'wrong' },
      body: '{}',
    })
    expect((await hook.json()).error).toBe('structured_json_ingest_token_invalid')
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
function login(url: string, token: string, next: string): Promise<Response> {
  return fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, next }), redirect: 'manual',
  })
}
test('development exception accepts only the fixed frontend port on the request hostname', async () => {
  const access = new ServerAccessController('guest', 'local', 5173)
  const target = new URL('http://127.0.0.1:5177/api/rooms')
  const request = (origin: string) => new Request(target, { headers: { host: target.host, origin } })
  expect(await access.admit(request('http://127.0.0.1:5173'), target)).toBeNull()
  expect((await access.admit(request('http://localhost:5173'), target))?.status).toBe(403)
  expect((await access.admit(request('http://127.0.0.2:5173'), target))?.status).toBe(403)
  expect((await access.admit(request('http://127.0.0.1:5174'), target))?.status).toBe(403)
  const rebound = new URL('http://attacker.invalid:5177/api/rooms')
  expect((await access.admit(new Request(rebound, { headers: { origin: rebound.origin } }), rebound))?.status).toBe(403)
})
test('only exact same-origin login UI assets bypass browser session', async () => {
  const access = new ServerAccessController('authenticated', 'local')
  for (const path of [LOGIN_QR_ASSET_PATH, LOGIN_STYLE_ASSET_PATH]) {
    const target = new URL('http://127.0.0.1:5177' + path)
    expect(await access.admit(new Request(target), target)).toBeNull()
    expect((await access.admit(new Request(target + '?v=1'), new URL(target + '?v=1')))?.status).toBe(401)
    expect((await access.admit(new Request(target, {
      headers: { origin: 'http://attacker.invalid', 'sec-fetch-site': 'cross-site' },
    }), target))?.status).toBe(403)
  }
  const applicationAsset = new URL('http://127.0.0.1:5177/assets/index.js')
  expect((await access.admit(new Request(applicationAsset), applicationAsset))?.status).toBe(401)
})
test('Vite dev admission preserves browser guards, authentication and LAN hosts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-vite-access-'))
  const backend = startShellDeckServer({ accessMode: 'authenticated', listenMode: 'lan', port: 0, dataRoot: root, devFrontendPort: 5173 })
  const env = ['SHELL_DECK_DEV_BACKEND_ORIGIN', 'SHELL_DECK_DEV_HOST', 'SHELL_DECK_DEV_LISTEN_MODE', 'VITE_SHELL_DECK_DEV_BACKEND_PORT']
  Object.assign(process.env, { [env[0]]: backend.url, [env[1]]: '0.0.0.0', [env[2]]: 'lan', [env[3]]: String(backend.port) })
  const vite = await createServer({ configFile: join(process.cwd(), 'vite.config.ts'), logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false } })
  try {
    await vite.listen()
    const address = vite.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('vite_test_address_unavailable')
    const url = 'http://127.0.0.1:' + address.port
    expect(vite.config.clearScreen).toBe(false)
    const attack = await fetch(url + '/', { headers: { accept: 'text/html', origin: 'http://attacker.invalid', 'sec-fetch-site': 'cross-site' }, redirect: 'manual' })
    expect(attack.status).toBe(403)
    expect(backend.manager.listRooms()).toEqual([])
    expect((await fetch(url + '/src/main.ts')).status).toBe(401)
    const loginAsset = await fetch(url + LOGIN_QR_ASSET_PATH)
    expect(loginAsset.status).toBe(200)
    const loginAssetSource = await loginAsset.text()
    expect(loginAssetSource).toContain('login_qr_payload_invalid')
    expect(loginAssetSource).not.toMatch(/from\s+["'][./]/)
    const loginStyle = await fetch(url + LOGIN_STYLE_ASSET_PATH)
    expect(loginStyle.status).toBe(200)
    expect(loginStyle.headers.get('content-type')).toContain('text/css')
    expect(await loginStyle.text()).toContain('.btn')
    expect((await fetch(url + LOGIN_QR_ASSET_PATH, {
      headers: { origin: 'http://attacker.invalid', 'sec-fetch-site': 'cross-site' },
    })).status).toBe(403)
    expect((await fetch(url + LOGIN_STYLE_ASSET_PATH, {
      headers: { origin: 'http://attacker.invalid', 'sec-fetch-site': 'cross-site' },
    })).status).toBe(403)
    expect((await fetch(url + '/src/loginQrClient.ts')).status).toBe(401)
    expect((await fetch(url + '/', { headers: { accept: 'text/html', host: hostname() + ':' + address.port, origin: 'http://' + hostname() + ':5173' }, redirect: 'manual' })).status).toBe(302)
    const accepted = await login(backend.url, backend.loginToken!, '/')
    const cookie = accepted.headers.get('set-cookie')!.split(';', 1)[0]
    expect((await fetch(url + '/src/main.ts', { headers: { cookie } })).status).toBe(200)
  } finally {
    await vite.close()
    await backend.stop()
    rmSync(root, { recursive: true, force: true })
    for (const name of env) delete process.env[name]
  }
}, 20_000)
