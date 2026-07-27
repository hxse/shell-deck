import decodeQR from 'qr/decode.js'
import { isLoginToken } from './loginToken'

export type LoginQrImage = {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray | number[]
}

export function decodeLoginTokenImage(image: LoginQrImage): string {
  return decodeAttempt(image, false)
}

export function decodeLoginTokenPhoto(image: LoginQrImage): string {
  let sawInvalidPayload = false
  for (const cropToSquare of image.width === image.height ? [false] : [false, true]) {
    try {
      return decodeAttempt(image, cropToSquare)
    } catch (error) {
      if (error instanceof Error && error.message === 'login_qr_payload_invalid') {
        sawInvalidPayload = true
      } else if (!(error instanceof Error) || error.message !== 'login_qr_not_found') {
        throw error
      }
    }
  }
  throw new Error(sawInvalidPayload ? 'login_qr_payload_invalid' : 'login_qr_not_found')
}

function decodeAttempt(image: LoginQrImage, cropToSquare: boolean): string {
  let payload: string
  try {
    payload = decodeQR(image, { cropToSquare })
  } catch {
    throw new Error('login_qr_not_found')
  }
  if (!isLoginToken(payload)) throw new Error('login_qr_payload_invalid')
  return payload
}
