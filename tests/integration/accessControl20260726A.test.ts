import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { ServerAccessController } from '../../server/accessControl'
import { startShellDeckServer } from '../../server/httpServer'
test('authenticated mode gates navigation, API and websocket before Room mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-access-20260726a-'))
  const server = startShellDeckServer({ accessMode: 'authenticated', listenMode: 'local', port: 0, dataRoot: root })
  try {
    expect(server.loginToken?.length).toBeGreaterThanOrEqual(22)
    const navigation = await fetch(server.url + '/', { headers: { accept: 'text/html' }, redirect: 'manual' })
    expect(navigation.status).toBe(302); expect(navigation.headers.get('location')).toBe('/login?next=%2F')
    expect((await fetch(server.url + '/login')).headers.get('referrer-policy')).toBe('same-origin')
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
})
