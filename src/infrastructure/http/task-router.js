import { Router } from 'express'

import { taskCatalogs } from '../../domain/task.js'
import { requireAuth } from './require-auth.js'
import { requireVerified } from './require-verified.js'

export function createTaskRouter({ useCases, tokens }) {
  const router = Router()

  router.get('/catalogs', (_req, res) => res.json(taskCatalogs))

  router.use(requireAuth({ tokens, useCases }), requireVerified())

  router.get('/', async (req, res) => {
    res.json(await useCases.listTasks(req.userId, req.query))
  })

  router.post('/', async (req, res) => {
    res.status(201).json(await useCases.createTask(req.userId, req.body))
  })

  /**
   * Va ANTES de `/:id` y no es un detalle de estilo: `:id` es un comodin que casaria con la cadena
   * "order" y mandaria esto a `updateTask` con id = 'order'. Declarada aqui, Express prueba las rutas
   * en orden y esta gana.
   */
  router.patch('/order', async (req, res) => {
    res.json(await useCases.orderTasks(req.userId, req.body?.ids))
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
