import { Router } from 'express'

import { catalogs } from '../../domain/user.js'
import { createForgotLimiter, createLoginLimiter } from './rate-limit.js'
import { requireAuth } from './require-auth.js'

export function createAuthRouter({ useCases, tokens }) {
  const router = Router()
  const limitLogin = createLoginLimiter()
  const limitForgot = createForgotLimiter()

  router.get('/catalogs', (_req, res) => res.json(catalogs))

  router.post('/register', async (req, res) => {
    res.status(201).json(await useCases.registerUser(req.body))
  })

  /**
   * El limitador va ANTES del caso de uso, asi que un intento frenado no llega ni a comparar el hash —
   * que es lo que de verdad cuesta (scrypt esta calibrado para ser lento a proposito).
   */
  router.post('/login', limitLogin, async (req, res) => {
    const session = await useCases.loginUser(req.body ?? {})
    // Entro bien: los intentos fallidos de antes no deben seguir contando.
    limitLogin.forgive(req.ip, req.body?.email)
    res.json(session)
  })

  router.post('/google', async (req, res) => {
    res.json(await useCases.loginWithGoogle(req.body ?? {}))
  })

  router.post('/apple', async (req, res) => {
    res.json(await useCases.loginWithApple(req.body ?? {}))
  })

  /**
   * "Olvide mi contraseña". Contesta **202 siempre**: exista la cuenta, sea de Google o este en
   * cooldown. Es lo que mantiene en pie la promesa de mas abajo — desde fuera no se puede
   * averiguar que correos tienen cuenta.
   *
   * El limitador va antes y cuenta por correo: este endpoint manda correos que pagamos nosotros.
   */
  router.post('/forgot', limitForgot, async (req, res) => {
    await useCases.forgotPassword(req.body ?? {})
    res.sendStatus(202)
  })

  /**
   * ponytail: /reset no lleva limitador propio. El freno es el contador de intentos del OTP (5 por
   * cuenta sobre un millon de codigos posibles) y el formato se valida antes de hashear, asi que un
   * intento a ciegas no cuesta ni scrypt. Techo: desde una IP se pueden quemar los 5 intentos de
   * muchas cuentas y obligarlas a pedir codigo nuevo — si alguien lo hace, entra el mismo limitador
   * por IP del login.
   */
  router.post('/reset', async (req, res) => {
    res.json(await useCases.resetPassword(req.body ?? {}))
  })

  // Verificar y reenviar exigen sesion pero NO correo verificado, y no reciben el correo en el
  // body: asi no hay forma de averiguar que correos existen. Los unicos que si lo reciben son
  // /forgot y /reset, que no pueden tener sesion todavia, y por eso los dos contestan lo mismo
  // exista o no la cuenta.
  router.post('/verify', requireAuth({ tokens, useCases }), async (req, res) => {
    res.json(await useCases.verifyEmail(req.userId, req.body ?? {}))
  })

  router.post('/resend', requireAuth({ tokens, useCases }), async (req, res) => {
    await useCases.resendCode(req.userId)
    res.sendStatus(202)
  })

  // Se queda por compatibilidad; el canonico ahora es GET /me.
  router.get('/me', requireAuth({ tokens, useCases }), async (req, res) => {
    res.json(await useCases.getProfile(req.userId))
  })

  return router
}
