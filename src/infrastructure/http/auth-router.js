import { Router } from 'express'

import { catalogs } from '../../domain/user.js'
import { createLoginLimiter } from './rate-limit.js'
import { requireAuth } from './require-auth.js'

export function createAuthRouter({ useCases, tokens }) {
  const router = Router()
  const limitLogin = createLoginLimiter()

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

  // Verificar y reenviar exigen sesion pero NO correo verificado, y no reciben el correo en
  // el body: asi no hay forma de averiguar que correos existen.
  router.post('/verify', requireAuth(tokens), async (req, res) => {
    res.json(await useCases.verifyEmail(req.userId, req.body ?? {}))
  })

  router.post('/resend', requireAuth(tokens), async (req, res) => {
    await useCases.resendCode(req.userId)
    res.sendStatus(202)
  })

  // Se queda por compatibilidad; el canonico ahora es GET /me.
  router.get('/me', requireAuth(tokens), async (req, res) => {
    res.json(await useCases.getProfile(req.userId))
  })

  return router
}
