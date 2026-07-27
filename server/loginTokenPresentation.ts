import encodeQR, { Bitmap } from 'qr'
import { decodeLoginTokenImage } from '../src/lib/loginQrDecoder'
import { isLoginToken } from '../src/lib/loginToken'

type LoginQrMask = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

const LOGIN_QR_MASKS: readonly LoginQrMask[] = [0, 1, 2, 3, 4, 5, 6, 7]
const SELF_TEST_SCALES = [2, 3, 4] as const

export function formatLoginTokenForTerminal(token: string): string {
  if (!isLoginToken(token)) throw new Error('invalid_login_token')
  const mask = selectLoginQrMask(token)
  return [
    'shell-deck login token: ' + token,
    'shell-deck login QR:',
    encodeQR(token, 'term', { border: 4, ecc: 'quartile', mask }),
  ].join('\n')
}

export function selectLoginQrMask(token: string): LoginQrMask {
  if (!isLoginToken(token)) throw new Error('invalid_login_token')
  for (const mask of LOGIN_QR_MASKS) {
    if (SELF_TEST_SCALES.every((scale) => selfDecodes(token, mask, scale))) return mask
  }
  throw new Error('login_qr_render_unreadable')
}

function selfDecodes(token: string, mask: LoginQrMask, scale: number): boolean {
  const modules = encodeQR(token, 'raw', {
    border: 4,
    ecc: 'quartile',
    mask,
    scale,
  })
  const image = new Bitmap({
    width: modules[0]!.length,
    height: modules.length,
  }, modules).toImage()
  try {
    return decodeLoginTokenImage(image) === token
  } catch {
    return false
  }
}
