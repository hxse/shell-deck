export const LOGIN_TOKEN_BYTES = 24
export const LOGIN_TOKEN_LENGTH = Math.ceil(LOGIN_TOKEN_BYTES * 4 / 3)
export const LOGIN_QR_ASSET_PATH = '/login-assets/login-qr.js'
export const LOGIN_STYLE_ASSET_PATH = '/login-assets/login.css'

const LOGIN_TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${LOGIN_TOKEN_LENGTH}}$`)

export function isLoginToken(value: unknown): value is string {
  return typeof value === 'string' && LOGIN_TOKEN_PATTERN.test(value)
}
