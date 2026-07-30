import jwt from 'jsonwebtoken'

import { UnauthorizedError } from '../../domain/errors.js'

export const createTokenService = ({ secret, expiresIn }) => ({
  // `ev` viaja en el token para no consultar la base en cada request; /auth/verify emite uno
  // nuevo, asi que nunca se queda viejo.
  issue: (user) =>
    jwt.sign({ sub: String(user.id), email: user.email, ev: !!user.emailVerified }, secret, { expiresIn }),

  verify(token) {
    try {
      const payload = jwt.verify(token, secret)
      // ponytail: `ev` ausente = verificado. Los tokens emitidos antes de que existiera el OTP
      // siguen valiendo, igual que el backfill de email_verified_at; caducan solos en 30 dias.
      return { id: Number(payload.sub), emailVerified: payload.ev !== false }
    } catch {
      throw UnauthorizedError('Sesion expirada, vuelve a entrar')
    }
  },
})
