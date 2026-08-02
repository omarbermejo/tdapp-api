import { Router } from 'express'

import { workspaceCatalogs } from '../../domain/workspace.js'
import { createJoinLimiter } from './rate-limit.js'
import { requireAuth } from './require-auth.js'
import { requireVerified } from './require-verified.js'

/**
 * Los espacios de trabajo. Router thin, como los demas: mapea HTTP a caso de uso y nada mas.
 *
 * Sin try/catch: Express 5 atrapa el throw de los handlers async y lo manda a `errorHandler`.
 */
/**
 * Un dia de cache. El catalogo solo cambia cuando se despliega otra version del API.
 *
 * SIN `immutable`: eso significaria "no revalides nunca, ni al recargar", y solo es correcto con URLs
 * direccionadas por contenido. Esta es fija y su contenido si cambia entre despliegues, asi que un
 * cliente se quedaria clavado en un catalogo viejo sin escapatoria durante todo el max-age. Con esto
 * mas el ETag debil que Express ya emite, pasado el dia se resuelve con un 304 vacio.
 */
const A_DAY = 'public, max-age=86400'

export function createWorkspaceRouter({ useCases, tokens }) {
  const router = Router()

  // Publica y ANTES del gate, igual que /tasks/catalogs: la pantalla de crear necesita las opciones
  // para pintarse, y son datos sin dueño.
  router.get('/catalogs', (_req, res) => res.set('Cache-Control', A_DAY).json(workspaceCatalogs))

  router.use(requireAuth({ tokens, useCases }), requireVerified())

  /**
   * UNA sola instancia para las dos rutas de codigo. Es el punto: la vista previa resuelve el mismo
   * codigo que aceptar, asi que con contadores separados seria un oraculo gratis para enumerarlos.
   * Va DESPUES de `requireAuth` porque cuenta por `req.userId`.
   */
  const limitJoin = createJoinLimiter()

  router.get('/', async (req, res) => {
    res.json(await useCases.listWorkspaces(req.userId))
  })

  router.post('/', async (req, res) => {
    res.status(201).json(await useCases.createWorkspace(req.userId, req.body))
  })

  /*
    Las rutas de UN SEGMENTO van ANTES de `/:id`: `:id` es un comodin y se comeria las palabras
    "collaborators" y "join". Es la misma trampa que ya obligo a poner `/tasks/order` antes de
    `/tasks/:id`.
  */
  router.get('/collaborators', async (req, res) => {
    res.json(await useCases.listCollaborators(req.userId))
  })

  router.post('/join/check', limitJoin, async (req, res) => {
    res.json(await useCases.previewInvite(req.userId, req.body ?? {}))
  })

  router.post('/join', limitJoin, async (req, res) => {
    const result = await useCases.acceptInvite(req.userId, req.body ?? {})
    // Entrar bien perdona los intentos fallidos: quien tecleo mal dos veces y acerto no arrastra nada.
    limitJoin.forgive(req.ip, req.userId)
    res.json(result)
  })

  /**
   * Quien pide entrar a algo mio. ANTES de `/:id/...`: 'requests' se comeria el hueco del id.
   * Es la misma trampa que ya obligo a poner 'collaborators' y 'join' arriba.
   */
  router.get('/requests', async (req, res) => {
    res.json(await useCases.listRequests(req.userId))
  })

  router.post('/:id/requests/:personId', async (req, res) => {
    const approve = (req.body ?? {}).approve !== false
    res.json(await useCases.decideRequest(req.userId, req.params.id, req.params.personId, approve))
  })

  router.get('/:id/members', async (req, res) => {
    res.json(await useCases.listMembers(req.userId, req.params.id))
  })

  router.get('/:id/invites', async (req, res) => {
    res.json(await useCases.listInvites(req.userId, req.params.id))
  })

  router.post('/:id/invites', async (req, res) => {
    res.status(201).json(await useCases.createInvite(req.userId, req.params.id, req.body ?? {}))
  })

  router.delete('/:id/invites/:code', async (req, res) => {
    await useCases.revokeInvite(req.userId, req.params.id, req.params.code)
    res.sendStatus(204)
  })

  router.get('/:id', async (req, res) => {
    res.json(await useCases.getWorkspace(req.userId, req.params.id))
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
