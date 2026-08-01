import express from 'express'

import { createAuthRouter } from './auth-router.js'
import { errorHandler } from './error-handler.js'
import { createMeRouter } from './me-router.js'
import { createTaskRouter } from './task-router.js'
import { createWorkspaceRouter } from './workspace-router.js'

export function createApp({ useCases, tokens, corsOrigin }) {
  const app = express()

  /**
   * Detras del proxy de la plataforma, `req.ip` es la IP del PROXY para todo el trafico si no se dice
   * esto. Sin `trust proxy`, el limite de `/auth/login` contaria a todos los usuarios del mundo como
   * uno: el primero que se equivocara ocho veces dejaria fuera al resto.
   *
   * Vale 1 y no `true`: solo se cree al ultimo salto (el proxy de la plataforma). Con `true` se creeria
   * cualquier `X-Forwarded-For` que llegue en la peticion, y entonces el atacante elige su propia IP y
   * se salta el limite escribiendo una distinta en cada intento.
   */
  app.set('trust proxy', 1)

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
  app.use('/workspaces', createWorkspaceRouter({ useCases, tokens }))
  app.use('/me', createMeRouter({ useCases, tokens }))
  app.use(errorHandler)

  return app
}
