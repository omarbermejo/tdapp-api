import { Router } from 'express'

import { requireAuth } from './require-auth.js'

/** Lo que consumen el widget, la Live Activity y la pantalla de inicio. */
export function createMeRouter({ useCases, tokens }) {
  const router = Router()
  router.use(requireAuth(tokens))

  router.get('/', async (req, res) => {
    res.json(await useCases.getProfile(req.userId))
  })

  router.get('/today', async (req, res) => {
    res.json(await useCases.getToday(req.userId, req.query.date))
  })

  router.post('/devices', async (req, res) => {
    res.status(201).json(await useCases.registerDevice(req.userId, req.body))
  })

  return router
}
