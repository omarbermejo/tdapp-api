import jwt from 'jsonwebtoken'

import { UnauthorizedError } from '../../domain/errors.js'

export const createTokenService = ({ secret, expiresIn }) => ({
  issue: (user) => jwt.sign({ sub: String(user.id), email: user.email }, secret, { expiresIn }),

  verify(token) {
    try {
      return Number(jwt.verify(token, secret).sub)
    } catch {
      throw UnauthorizedError('Sesion expirada, vuelve a entrar')
    }
  },
})
