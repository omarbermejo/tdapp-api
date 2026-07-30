import { UnauthorizedError } from '../../domain/errors.js'

/**
 * Deja el id en req.userId y si el correo esta verificado en req.emailVerified.
 * Express 5 atrapa el throw y lo manda al errorHandler.
 */
export const requireAuth = (tokens) => (req, _res, next) => {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ')
  if (scheme !== 'Bearer' || !token) throw UnauthorizedError()
  const { id, emailVerified } = tokens.verify(token)
  req.userId = id
  req.emailVerified = emailVerified
  next()
}
