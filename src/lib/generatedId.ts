import { constants, createTranslator } from 'short-uuid'

export const GENERATED_ID_PREFIX = {
  room: 'room_',
  serverInstance: 'server_',
  roomGeneration: 'roomgen_',
  client: 'client_',
  roomControlLease: 'control_',
  contentEditLease: 'edit_',
  terminal: 'term_',
  terminalLaunch: 'launch_',
  macroTemplate: 'tmpl_',
  run: 'run_',
  runEvent: 'evt_',
  libraryItem: 'lib_',
  notification: 'notif_',
} as const

export type GeneratedIdKind = keyof typeof GENERATED_ID_PREFIX

export const GENERATED_ID_SUFFIX_LENGTH = 22

const translator = createTranslator(constants.flickrBase58, { consistentLength: true })
const alphabet = new Set(constants.flickrBase58)
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createGeneratedSuffix(): string {
  const suffix = translator.generate()
  assertGeneratedSuffix(suffix)
  return suffix
}

export function createGeneratedId<K extends GeneratedIdKind>(kind: K): `${(typeof GENERATED_ID_PREFIX)[K]}${string}` {
  return `${GENERATED_ID_PREFIX[kind]}${createGeneratedSuffix()}`
}

export function assertGeneratedId<K extends GeneratedIdKind>(value: unknown, kind: K): `${(typeof GENERATED_ID_PREFIX)[K]}${string}` {
  if (typeof value !== 'string') throw new Error(`invalid_${kind}_id`)
  const prefix = GENERATED_ID_PREFIX[kind]
  if (!value.startsWith(prefix)) throw new Error(`invalid_${kind}_id`)
  assertGeneratedSuffix(value.slice(prefix.length))
  return value as `${(typeof GENERATED_ID_PREFIX)[K]}${string}`
}

export function isGeneratedId<K extends GeneratedIdKind>(value: unknown, kind: K): value is `${(typeof GENERATED_ID_PREFIX)[K]}${string}` {
  try {
    assertGeneratedId(value, kind)
    return true
  } catch {
    return false
  }
}

export function assertRoomRouteToken(value: unknown): string {
  return assertGeneratedId(value, 'room')
}

function assertGeneratedSuffix(suffix: string): void {
  if (suffix.length !== GENERATED_ID_SUFFIX_LENGTH) throw new Error('invalid_generated_id_suffix')
  for (const char of suffix) {
    if (!alphabet.has(char)) throw new Error('invalid_generated_id_suffix')
  }

  let uuid: string
  try {
    uuid = translator.toUUID(suffix)
  } catch {
    throw new Error('invalid_generated_id_suffix')
  }
  if (!UUID_V4_RE.test(uuid)) throw new Error('invalid_generated_id_suffix')
  if (translator.fromUUID(uuid) !== suffix) throw new Error('invalid_generated_id_suffix')
  if (!translator.validate(suffix, true)) throw new Error('invalid_generated_id_suffix')
}
