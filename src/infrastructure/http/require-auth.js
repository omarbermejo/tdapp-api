import { UnauthorizedError } from '../../domain/errors.js'

/**
 * Deja el id en req.userId y si el correo esta verificado en req.emailVerified.
 * Express 5 atrapa el throw (tambien de un handler async) y lo manda al errorHandler.
 *
 * Recibe `useCases` y no el repositorio porque los tres routers ya lo tienen: asi el chequeo entra
 * sin tocar app.js ni la composicion. La regla de "esta cuenta sigue siendo la misma" vive en
 * `application/authenticate.js`, que explica por que hace falta.
 */
export const requireAuth =
  ({ tokens, useCases }) =>
  async (req, _res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ')
    if (scheme !== 'Bearer' || !token) throw UnauthorizedError()

    const { id, email, emailVerified, issuedAt } = tokens.verify(token)
    // Firmar bien no basta: el id se recicla al borrar cuentas. Lanza 401 si la cuenta ya no esta
    // o si el token no es de la cuenta que ocupa ese id ahora.
    await useCases.authenticate({ id, email, issuedAt })

    req.userId = id
    req.emailVerified = emailVerified
    next()
  }
