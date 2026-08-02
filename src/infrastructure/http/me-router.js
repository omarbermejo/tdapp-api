import { Router } from 'express'

import { requireAuth } from './require-auth.js'
import { requireVerified } from './require-verified.js'

/** Lo que consumen el widget, la Live Activity y la pantalla de inicio. */
export function createMeRouter({ useCases, tokens }) {
  const router = Router()
  router.use(requireAuth({ tokens, useCases }))

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
   * El token sigue firmado hasta que venza (30 dias) y no hay lista negra, pero **no basta con que
   * la fila haya desaparecido**: `users.id` no lleva AUTOINCREMENT, asi que SQLite recicla el rowid
   * y la siguiente cuenta que se registre nace con el id de esta. Sin nada mas, el token de la
   * cuenta borrada leeria y escribiria los datos de esa otra persona — comprobado, no teorico. Lo
   * que cierra el agujero es `application/authenticate.js`, que corre en cada request autenticado
   * y rechaza un token anterior a la cuenta que ocupa su id. Ahi esta el argumento completo.
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

  // Aparte de /streak por la misma razon que /streak esta aparte de /today: la racha la pide el
  // widget en cada sincronizacion y esto solo lo pide una pantalla que casi nadie abre a diario.
  router.get('/stats', async (req, res) => {
    res.json(await useCases.getStats(req.userId, req.query))
  })

  /**
   * El resumen de la tarjeta del perfil. Aparte de /stats porque no es la misma pregunta: /stats
   * mira una ventana de cuatro semanas y solo tareas con fecha, esto mira la vida entera de la
   * cuenta. Un contador de perfil que encoge con el tiempo no es un contador.
   */
  router.get('/tasks/summary', async (req, res) => {
    res.json(await useCases.getTaskCounts(req.userId))
  })

  /**
   * El vestidor. No va en `/auth/catalogs` aunque suene a catalogo: la respuesta depende de quien
   * pregunta — que logros lleva y que caras eligio — y `catalogs` es publico y sin usuario.
   *
   * `?date=` por lo mismo que en /streak: la mejor racha se mide en dias locales del cliente.
   */
  router.get('/avatars', async (req, res) => {
    res.json(await useCases.getAvatars(req.userId, req.query.date))
  })

  /**
   * Quedarse con una de las tres caras de un logro cumplido. Es la unica forma de ganar una: nada
   * de esto pasa por PATCH /profile, que solo cambia la que llevas puesta.
   *
   * 200 y no 201: devuelve el vestidor entero al dia, no un recurso nuevo con URL propia.
   */
  router.post('/avatars', async (req, res) => {
    res.json(await useCases.claimAvatar(req.userId, req.body ?? {}, req.query.date))
  })

  /**
   * Las novedades de tus tareas.
   *
   * `?before=` pagina hacia atras y `?since=` trae el hueco que te perdiste — el cliente usa el
   * segundo al reconectar el socket, y por eso la pantalla funciona igual con el socket caido: la
   * tabla es la fuente y el tiempo real solo se salta la espera.
   */
  router.get('/events', async (req, res) => {
    res.json(await useCases.listEvents(req.userId, req.query))
  })

  /** Solo el numero del globo. El inicio lo pide en cada foco y no necesita ni una fila. */
  router.get('/events/unread', async (req, res) => {
    res.json(await useCases.countUnread(req.userId))
  })

  /** Sin `id` en el cuerpo, marca todas. Devuelve el contador ya recalculado. */
  router.post('/events/read', async (req, res) => {
    res.json(await useCases.readEvents(req.userId, req.body?.id ?? null))
  })

  router.patch('/profile', async (req, res) => {
    res.json(await useCases.updateProfile(req.userId, req.body ?? {}))
  })

  router.post('/devices', async (req, res) => {
    res.status(201).json(await useCases.registerDevice(req.userId, req.body))
  })

  return router
}
