import { Router } from 'express'

import { UnauthorizedError } from '../../domain/errors.js'
import { catalogs } from '../../domain/user.js'

export function createAuthRouter({ useCases, tokens }) {
  const router = Router()

  router.get('/catalogs', (_req, res) => res.json(catalogs))

  router.post('/register', async (req, res) => {
    res.status(201).json(await useCases.registerUser(req.body))
  })

  router.post('/login', async (req, res) => {
    res.json(await useCases.loginUser(req.body ?? {}))
  })

  router.get('/me', async (req, res) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ')
    if (scheme !== 'Bearer' || !token) throw UnauthorizedError()
    res.json(await useCases.getProfile(tokens.verify(token)))
  })

  return router
}
