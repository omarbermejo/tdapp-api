import { Router } from 'express'

import { taskCatalogs } from '../../domain/task.js'
import { requireAuth } from './require-auth.js'

export function createTaskRouter({ useCases, tokens }) {
  const router = Router()

  router.get('/catalogs', (_req, res) => res.json(taskCatalogs))

  router.use(requireAuth(tokens))

  router.get('/', async (req, res) => {
    res.json(await useCases.listTasks(req.userId, req.query))
  })

  router.post('/', async (req, res) => {
    res.status(201).json(await useCases.createTask(req.userId, req.body))
  })

  router.patch('/:id', async (req, res) => {
    res.json(await useCases.updateTask(req.userId, req.params.id, req.body))
  })

  router.delete('/:id', async (req, res) => {
    await useCases.deleteTask(req.userId, req.params.id)
    res.sendStatus(204)
  })

  router.post('/:id/timer', async (req, res) => {
    res.json(await useCases.toggleTimer(req.userId, req.params.id, req.body?.action))
  })

  return router
}
