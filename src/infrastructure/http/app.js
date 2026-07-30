import express from 'express'

import { createAuthRouter } from './auth-router.js'
import { errorHandler } from './error-handler.js'
import { createMeRouter } from './me-router.js'
import { createTaskRouter } from './task-router.js'

export function createApp({ useCases, tokens, corsOrigin }) {
  const app = express()
  app.use(express.json({ limit: '16kb' }))

  // ponytail: sin dependencia cors, son 4 headers. CORS_ORIGIN=* solo sirve para Expo web en dev.
  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    })
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/auth', createAuthRouter({ useCases, tokens }))
  app.use('/tasks', createTaskRouter({ useCases, tokens }))
  app.use('/me', createMeRouter({ useCases, tokens }))
  app.use(errorHandler)

  return app
}
