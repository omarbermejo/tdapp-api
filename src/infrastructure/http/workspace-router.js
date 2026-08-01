import { Router } from 'express'

import { workspaceCatalogs } from '../../domain/workspace.js'
import { requireAuth } from './require-auth.js'
import { requireVerified } from './require-verified.js'

/**
 * Los espacios de trabajo. Router thin, como los demas: mapea HTTP a caso de uso y nada mas.
 *
 * Sin try/catch: Express 5 atrapa el throw de los handlers async y lo manda a `errorHandler`.
 */
export function createWorkspaceRouter({ useCases, tokens }) {
  const router = Router()

  // Publica y ANTES del gate, igual que /tasks/catalogs: la pantalla de crear necesita las opciones
  // para pintarse, y son datos sin dueño.
  router.get('/catalogs', (_req, res) => res.json(workspaceCatalogs))

  router.use(requireAuth({ tokens, useCases }), requireVerified())

  router.get('/', async (req, res) => {
    res.json(await useCases.listWorkspaces(req.userId))
  })

  router.post('/', async (req, res) => {
    res.status(201).json(await useCases.createWorkspace(req.userId, req.body))
  })

  router.patch('/:id', async (req, res) => {
    res.json(await useCases.updateWorkspace(req.userId, req.params.id, req.body))
  })

  router.delete('/:id', async (req, res) => {
    await useCases.deleteWorkspace(req.userId, req.params.id)
    res.sendStatus(204)
  })

  return router
}
