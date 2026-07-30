import { UnauthorizedError } from '../../domain/errors.js'

/** Deja el id del usuario en req.userId. Express 5 atrapa el throw y lo manda al errorHandler. */
export const requireAuth = (tokens) => (req, _res, next) => {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ')
  if (scheme !== 'Bearer' || !token) throw UnauthorizedError()
  req.userId = tokens.verify(token)
  next()
}
