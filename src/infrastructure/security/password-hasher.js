import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

// ponytail: scrypt de stdlib en vez de bcrypt/argon2, sin dependencia nativa que compilar.
export const scryptHasher = {
  async hash(password) {
    const salt = randomBytes(16)
    const key = await scryptAsync(password, salt, KEY_LENGTH)
    return `${salt.toString('hex')}:${key.toString('hex')}`
  },

  async verify(password, stored) {
    const [salt, key] = String(stored).split(':')
    const expected = Buffer.from(key ?? '', 'hex')
    if (expected.length !== KEY_LENGTH) return false
    const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), KEY_LENGTH)
    return timingSafeEqual(actual, expected)
  },
}
