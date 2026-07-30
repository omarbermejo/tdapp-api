import { ForbiddenError } from '../../domain/errors.js'

/**
 * Se monta despues de requireAuth. El token del registro prueba que alguien sabe la contraseña
 * que acaba de elegir, no que el correo sea suyo: hasta verificarlo solo abre GET /me,
 * /auth/verify y /auth/resend.
 */
export const requireVerified = () => (req, _res, next) => {
  if (!req.emailVerified) throw ForbiddenError('Verifica tu correo para continuar')
  next()
}
