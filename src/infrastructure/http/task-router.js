import { Router } from 'express'

import { taskCatalogs } from '../../domain/task.js'
import { requireAuth } from './require-auth.js'
import { requireVerified } from './require-verified.js'

/**
 * Un dia de cache. El catalogo solo cambia cuando se despliega otra version del API.
 *
 * SIN `immutable`: eso significaria "no revalides nunca, ni al recargar", y solo es correcto con URLs
 * direccionadas por contenido. Esta es fija y su contenido si cambia entre despliegues, asi que un
 * cliente se quedaria clavado en un catalogo viejo sin escapatoria durante todo el max-age. Con esto
 * mas el ETag debil que Express ya emite, pasado el dia se resuelve con un 304 vacio.
 */
const A_DAY = 'public, max-age=86400'

export function createTaskRouter({ useCases, tokens }) {
  const router = Router()

  router.get('/catalogs', (_req, res) => res.set('Cache-Control', A_DAY).json(taskCatalogs))

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
