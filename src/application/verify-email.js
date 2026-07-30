import { NotFoundError, ValidationError } from '../domain/errors.js'
import { CODE, EMAIL_VERIFY } from '../domain/otp.js'
import { toPublicUser } from '../domain/user.js'

const session = (row, tokens) => {
  const user = toPublicUser(row)
  return { user, token: tokens.issue(user) }
}

export const verifyEmail =
  ({ users, hasher, otps, tokens, otpRules }) =>
  async (userId, { code } = {}) => {
    const row = await users.findById(userId)
    if (!row) throw NotFoundError('Usuario no encontrado')

    // Idempotente: un reintento de la app no la deja trabada, le devuelve token fresco.
    if (row.emailVerifiedAt) return session(row, tokens)

    // El formato se valida antes de hashear: no quema uno de los 5 intentos ni 100ms de scrypt.
    const typed = String(code ?? '').trim()
    if (!CODE.test(typed)) throw ValidationError({ code: 'Escribe los 6 digitos del codigo' })

    const active = await otps.find(userId, EMAIL_VERIFY)
    if (!active) throw ValidationError({ code: 'Pide un codigo nuevo' })
    if (active.expired) {
      await otps.remove(userId, EMAIL_VERIFY)
      throw ValidationError({ code: 'El codigo vencio. Pide uno nuevo.' })
    }
    if (active.attempts >= otpRules.maxAttempts) {
      throw ValidationError({ code: 'Muchos intentos. Pide un codigo nuevo.' })
    }

    if (!(await hasher.verify(typed, active.codeHash))) {
      await otps.addAttempt(userId, EMAIL_VERIFY)
      const left = otpRules.maxAttempts - (active.attempts + 1)
      throw ValidationError({
        code: left > 0 ? 'Ese codigo no es. Revisa el correo.' : 'Muchos intentos. Pide un codigo nuevo.',
      })
    }

    await otps.remove(userId, EMAIL_VERIFY)
    return session(await users.markEmailVerified(userId), tokens)
  }
