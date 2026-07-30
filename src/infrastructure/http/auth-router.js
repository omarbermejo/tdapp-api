import { Router } from 'express'

import { catalogs } from '../../domain/user.js'
import { requireAuth } from './require-auth.js'

export function createAuthRouter({ useCases, tokens }) {
  const router = Router()

  router.get('/catalogs', (_req, res) => res.json(catalogs))

  router.post('/register', async (req, res) => {
    res.status(201).json(await useCases.registerUser(req.body))
  })

  router.post('/login', async (req, res) => {
    res.json(await useCases.loginUser(req.body ?? {}))
  })

  router.post('/google', async (req, res) => {
    res.json(await useCases.loginWithGoogle(req.body ?? {}))
  })

  router.post('/apple', async (req, res) => {
    res.json(await useCases.loginWithApple(req.body ?? {}))
  })

  // Se queda por compatibilidad; el canonico ahora es GET /me.
  router.get('/me', requireAuth(tokens), async (req, res) => {
    res.json(await useCases.getProfile(req.userId))
  })

  return router
}
