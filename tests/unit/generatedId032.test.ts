import { expect, test } from 'bun:test'
import { createTranslator } from 'short-uuid'
import { GENERATED_ID_PREFIX, assertGeneratedId, assertRoomRouteToken, createGeneratedId, createGeneratedSuffix, isGeneratedId } from '../../src/lib/generatedId'

test('all system ids use one 22-character UUID-v4 suffix contract', () => {
  const translator = createTranslator()
  for (const kind of Object.keys(GENERATED_ID_PREFIX) as Array<keyof typeof GENERATED_ID_PREFIX>) {
    const id = createGeneratedId(kind)
    const suffix = id.slice(GENERATED_ID_PREFIX[kind].length)
    const uuid = translator.toUUID(suffix)
    expect(suffix).toHaveLength(22)
    expect(uuid[14]).toBe('4')
    expect('89ab').toContain(uuid[19].toLowerCase())
    expect(assertGeneratedId(id, kind)).toBe(id)
    expect(isGeneratedId(id, kind)).toBe(true)
  }
})

test('strict validation rejects old, truncated, wrong-version and wrong-prefix ids', () => {
  const translator = createTranslator()
  const v1Suffix = translator.fromUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
  expect(() => assertRoomRouteToken('r_123456789012345678901')).toThrow()
  expect(() => assertRoomRouteToken('room_short')).toThrow()
  expect(() => assertRoomRouteToken('room_' + v1Suffix)).toThrow()
  expect(() => assertGeneratedId(createGeneratedId('terminal'), 'room')).toThrow()
  expect(createGeneratedSuffix()).toHaveLength(22)
})
