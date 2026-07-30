import { Router } from 'express'

import { requireAuth } from './require-auth.js'
import { requireVerified } from './require-verified.js'

/** Lo que consumen el widget, la Live Activity y la pantalla de inicio. */
export function createMeRouter({ useCases, tokens }) {
  const router = Router()
  router.use(requireAuth(tokens))

  // GET / queda abierto a cuentas sin verificar: es de donde la app saca en que paso va.
  router.get('/', async (req, res) => {
    res.json(await useCases.getProfile(req.userId))
  })

  router.use(requireVerified())

  router.get('/today', async (req, res) => {
    res.json(await useCases.getToday(req.userId, req.query.date))
  })

  router.patch('/profile', async (req, res) => {
    res.json(await useCases.updateProfile(req.userId, req.body ?? {}))
  })

  router.post('/devices', async (req, res) => {
    res.status(201).json(await useCases.registerDevice(req.userId, req.body))
  })

  return router
}
