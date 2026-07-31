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

  /**
   * Borrar la cuenta. Va ARRIBA de requireVerified, con GET / y no con el resto: una cuenta sin
   * verificar tambien tiene derecho a irse, y es justo con una cuenta recien creada con la que App
   * Review prueba esto (guideline 5.1.1(v)). Detras del gate, la cuenta atrapada en la pantalla del
   * codigo seria la unica de la app que no se puede borrar.
   *
   * 204 y sin cuerpo: no hay nada que contar de una cuenta que ya no existe.
   *
   * ponytail: el token sigue firmado hasta que venza (30 dias) y no hay lista negra. Hoy no abre
   * nada, y no por suerte: cada consulta filtra por user_id sobre una fila que ya no esta (GET /me
   * contesta 404) y cualquier INSERT rebota contra la clave ajena. La app borra su almacen en el
   * mismo gesto. Techo: el dia que exista un endpoint que no cuelgue de la fila del usuario, hace
   * falta invalidar de verdad — token_version en users y una lectura de la base en requireAuth,
   * que hoy no toca la base a proposito.
   */
  router.delete('/', async (req, res) => {
    await useCases.deleteAccount(req.userId, req.body ?? {})
    res.sendStatus(204)
  })

  router.use(requireVerified())

  router.get('/today', async (req, res) => {
    res.json(await useCases.getToday(req.userId, req.query.date))
  })

  // La racha va aparte de /today y no dentro: son dos preguntas distintas y el widget de racha no
  // necesita las tareas del dia ni al contrario. Meterlas juntas obligaria a la mitad de los widgets
  // a traerse datos que no usan.
  router.get('/streak', async (req, res) => {
    res.json(await useCases.getStreak(req.userId, req.query.date))
  })

  router.patch('/profile', async (req, res) => {
    res.json(await useCases.updateProfile(req.userId, req.body ?? {}))
  })

  router.post('/devices', async (req, res) => {
    res.status(201).json(await useCases.registerDevice(req.userId, req.body))
  })

  return router
}
