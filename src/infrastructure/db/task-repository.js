/**
 * Las columnas de la tarea MAS el cronometro de quien pregunta.
 *
 * `started_at` y `elapsed_seconds` ya no viven en `tasks`: son de la persona, no de la fila. Llegan por
 * un LEFT JOIN a `task_timers` (LEFT y no JOIN: la inmensa mayoria de las tareas no se han cronometrado
 * nunca, y sin el desaparecerian de la lista). El `COALESCE` traduce "no hay fila" a "cero segundos",
 * que es lo que el dominio espera.
 *
 * **El `?` de `tm.user_id = ?` va PRIMERO en cada `.get()`/`.all()`**, antes que los del WHERE: los
 * parametros posicionales se ligan en el orden en que aparecen en el TEXTO del SQL, y el JOIN se
 * escribe antes que el WHERE. Es el fallo mas facil de cometer en este archivo y no avisa — devuelve
 * filas, solo que con el cronometro de otra persona.
 */
const TIMED = `LEFT JOIN task_timers tm ON tm.task_id = tasks.id AND tm.user_id = ?`

/**
 * La clasificacion del espacio al que pertenece la tarea.
 *
 * Se resuelve AQUI y no en el cliente porque el cliente tiene el `workspaceId` de la tarea pero no el
 * espacio entero: pintarlo alla obligaria a que cada fila tuviera a mano la lista de espacios.
 *
 * Sin bind: es un JOIN por clave ajena, no depende de quien pregunta.
 */
const TAGGED = `LEFT JOIN workspaces ws ON ws.id = tasks.workspace_id`

const COLUMNS = `tasks.id, tasks.user_id, tasks.title, tasks.notes, tasks.size, tasks.minutes,
                 tasks.status, tasks.focus_area, tasks.icon, tasks.due_at, tasks.due_date,
                 tasks.completed_at, tasks.completed_by, tasks.created_at,
                 tasks.workspace_id, tasks.position,
                 tm.started_at, COALESCE(tm.elapsed_seconds, 0) AS elapsed_seconds,
                 ws.tag AS workspace_tag`

/**
 * La frontera: una tarea es TUYA o vive en un espacio del que eres MIEMBRO.
 *
 * Liga `userId` DOS veces, en ese orden.
 *
 * Cualificado con `tasks.` y no a secas: `byId` lleva el LEFT JOIN a `task_timers`, que TAMBIEN tiene
 * `user_id`, asi que sin el prefijo SQLite falla con "ambiguous column name" al PREPARAR — o sea al
 * arrancar el proceso, no al usarlo. Dentro del subselect no hace falta: ahi el ambito mas interno
 * (`workspace_members`) gana.
 *
 * **Solo se usa en los caminos de "una tarea por id"** (leer, editar, borrar, reordenar, cronometrar).
 * `listByUser` sin espacio y las tres agregaciones siguen filtrando por `user_id` a secas: el modo
 * general de la app no cambia, y con el se quedan igual el widget, la Live Activity y la racha.
 */
const VISIBLE = `(tasks.user_id = ?
  OR (tasks.workspace_id IS NOT NULL
      AND tasks.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)))`

/**
 * El alcance de una consulta que puede venir acotada a un espacio. Dos ramas, como `listByUser`.
 *
 * - **Sin espacio**: `user_id = ?`, exactamente como siempre. Es lo que deja intactos el widget, la
 *   Live Activity, la racha y los logros, que es la decision de diseno de todo este trabajo.
 * - **Con espacio**: TODO lo que vive ahi, sea de quien sea, si eres miembro.
 *
 * La segunda rama existe porque sin ella el espacio se contaba a medias: `user_id = ? AND
 * workspace_id = ?` son *tus* tareas dentro del espacio, mientras el anillo de la card y la lista de
 * tareas de esa misma pantalla ya cuentan las de todos. En un espacio compartido el mapa de calor
 * decia un numero y la lista de debajo otro.
 *
 * No comprueba que el espacio exista: si no es tuyo, el EXISTS no encuentra nada y la respuesta sale
 * en ceros. Es lo correcto — un 404 aqui diria si un id ajeno existe o no.
 *
 * Devuelve el fragmento y sus binds JUNTOS para que no puedan desincronizarse: uno de los dos casos
 * liga un solo valor y el otro dos, y ese es el error tipico al copiar este patron.
 */
const spanning = (userId, workspaceId) =>
  workspaceId
    ? {
        sql: `workspace_id = ?
          AND EXISTS (SELECT 1 FROM workspace_members m
                       WHERE m.workspace_id = tasks.workspace_id AND m.user_id = ?)`,
        binds: [workspaceId, userId],
      }
    : { sql: 'user_id = ?', binds: [userId] }

const toDomain = (row) =>
  row && {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    size: row.size,
    minutes: row.minutes,
    status: row.status,
    focusArea: row.focus_area,
    icon: row.icon,
    dueAt: row.due_at,
    dueDate: row.due_date,
    startedAt: row.started_at,
    elapsedSeconds: row.elapsed_seconds,
    completedAt: row.completed_at,
    /** Quien la cerro. Puede no ser el dueño: en un espacio compartido cierra cualquier miembro. */
    completedBy: row.completed_by,
    createdAt: row.created_at,
    workspaceId: row.workspace_id,
    /** La clasificacion del espacio, para que la tarea la herede. Ver `TAGGED`. */
    workspaceTag: row.workspace_tag ?? null,
    /** null = nadie ha ordenado este dia a mano. Ver el ORDER BY de `listByUser`. */
    position: row.position,
  }

export function createTaskRepository(db) {
  // `position` NO va aqui: una tarea nueva nace sin posicion, y eso es informacion — significa que
  // nadie la ha colocado a mano, asi que cae al final del dia por el ORDER BY de `listByUser`.
  const insert = db.prepare(`INSERT INTO tasks
    (user_id, title, notes, size, minutes, status, focus_area, icon, due_at, due_date, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  /*
    Los cinco de la frontera. Se mueven JUNTOS a `VISIBLE` y eso no es orden, es correccion: abrir la
    lectura y dejar una escritura en `user_id = ?` hace que el UPDATE no encuentre fila, que la
    relectura devuelva undefined y que `toPublicTask(undefined)` reviente con un 500.
  */
  const byId = db.prepare(`SELECT ${COLUMNS} FROM tasks ${TIMED} ${TAGGED} WHERE ${VISIBLE} AND tasks.id = ?`)

  /**
   * El cronometro que TU tienes corriendo, en la tarea que sea — tuya o de un espacio compartido.
   *
   * Entra por `task_timers` y no por `tasks`: con el filtro viejo (`tasks.user_id`), un cronometro que
   * Ana arrancara en una tarea de Omar no aparecia como suyo y su pantalla salia vacia con el reloj en
   * marcha. Aqui `tm.user_id` es el actor, que es lo que la pregunta significa.
   */
  const running = db.prepare(`SELECT ${COLUMNS} FROM tasks ${TIMED} ${TAGGED}
    WHERE tm.started_at IS NOT NULL LIMIT 1`)

  const del = db.prepare(`DELETE FROM tasks WHERE ${VISIBLE} AND id = ?`)

  /** Un cronometro por (tarea, persona): el upsert crea la fila la primera vez que le das a empezar. */
  const setTimer = db.prepare(`INSERT INTO task_timers (task_id, user_id, started_at, elapsed_seconds)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id, user_id) DO UPDATE SET started_at = excluded.started_at,
                                               elapsed_seconds = excluded.elapsed_seconds`)
  /**
   * La lista de columnas es FIJA, y `position` no esta en ella a proposito: asi un PATCH normal
   * (renombrar, marcar hecha, mover de dia) no puede pisar el orden que la persona puso a mano. Lo
   * unico que escribe `position` es `setPositions`.
   *
   * `completed_by` SI entra: lo resuelve `update-task` en el mismo movimiento que `completed_at`, y
   * separarlos dejaria una tarea cerrada sin dueño del merito por un frame.
   */
  const patch = db.prepare(`UPDATE tasks SET
    title = ?, notes = ?, size = ?, minutes = ?, status = ?, focus_area = ?, icon = ?,
    due_at = ?, due_date = ?, completed_at = ?, completed_by = ?, workspace_id = ?
    WHERE ${VISIBLE} AND id = ?`)
  /**
   * Cuantas tareas tiene la cuenta por estado, de toda su historia.
   *
   * Sin ventana de fechas y sin `due_date IS NOT NULL`, al reves que doneStats: esto alimenta la
   * tarjeta del perfil, que cuenta una vida entera y no cuatro semanas. Con los filtros de
   * doneStats el numero ENCOGERIA con el tiempo — cierras doscientas cosas en el año y la tarjeta
   * dice doce — y las tareas que nunca se agendaron no existirian nunca.
   *
   * Barato aunque no tenga indice propio: `tasks_user_date` empieza por user_id, asi que el motor
   * lo usa para quedarse solo con las filas de esta persona.
   *
   * Devuelve filas crudas: la equivalencia estado -> llave la resuelve el caso de uso con
   * TASK_STATUS. SQL tonto, dominio en el dominio.
   */
  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE user_id = ? GROUP BY status')

  /** El unico sitio que escribe `position`. Ver el docblock de `patch`. */
  const setPosition = db.prepare(`UPDATE tasks SET position = ? WHERE ${VISIBLE} AND id = ?`)

  /**
   * Cuales de estos ids puede tocar esta persona. De aqui sale la validacion de `setPositions`.
   *
   * Pasa a `VISIBLE` porque el orden es del ESPACIO: un miembro que reordena su dia mueve tareas de
   * sus compañeros, y con el filtro viejo la lista se rechazaria entera en cuanto tuviera una.
   */
  const visibleIn = (n) =>
    db.prepare(
      `SELECT id FROM tasks WHERE ${VISIBLE} AND id IN (${Array.from({ length: n }, () => '?').join(', ')})`
    )

  /**
   * Los dos binds que pide `VISIBLE`, en su orden.
   *
   * Existe para que nadie escriba uno solo. Ese es el fallo silencioso de todo este archivo: con un
   * bind de menos, `node:sqlite` corre la sentencia con el `id` metido en el hueco del segundo
   * `user_id` y devuelve cero filas — no un error, cero filas. La lectura se ve como "no existe" y la
   * escritura como "no pasó nada".
   */
  const seen = (userId) => [userId, userId]

  // node:sqlite no trae helper de transaccion: se hace a mano y siempre con ROLLBACK en el catch.
  // Es el mismo patron de `user-repository.js`.
  const inTransaction = (work) => {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    async create(userId, task) {
      const { lastInsertRowid } = insert.run(
        userId, task.title, task.notes, task.size, task.minutes, task.status,
        task.focusArea, task.icon ?? null, task.dueAt, task.dueDate, task.workspaceId
      )
      // El bind del cronometro va PRIMERO: el LEFT JOIN se escribe antes que el WHERE. Ver `TIMED`.
      return toDomain(byId.get(userId, ...seen(userId), Number(lastInsertRowid)))
    },

    async findById(userId, id) {
      return toDomain(byId.get(userId, ...seen(userId), Number(id)))
    },

    async findRunning(userId) {
      return toDomain(running.get(userId))
    },

    /**
     * Cuantas tareas cerro el usuario cada dia, del mas reciente al mas viejo.
     *
     * Agrupa por `due_date` y no por `completed_at`: `due_date` es el dia LOCAL que mando el cliente
     * (texto 'YYYY-MM-DD'), mientras `completed_at` es un timestamp UTC. Con el segundo, cerrar algo a
     * las 11 de la noche en Mexico contaria para el dia siguiente y la racha se rompaeria sola — es la
     * misma razon por la que el resto del API compara texto en vez de adivinar zonas.
     *
     * Los dias sin nada cerrado simplemente no salen; quien cuenta la racha ve el hueco.
     */
    async doneByDay(userId, { from, to }) {
      return db
        .prepare(`SELECT due_date AS date, COUNT(*) AS done FROM tasks
          WHERE user_id = ?
            AND status = 'done'
            AND due_date IS NOT NULL
            AND due_date >= ?
            AND due_date <= ?
          GROUP BY due_date
          ORDER BY due_date DESC`)
        .all(userId, from, to)
    },

    /**
     * Cuantas tareas hay AGENDADAS cada dia, cerradas o no.
     *
     * Es la pregunta del mapa de calor y es distinta de `doneByDay`: ahi el color mide logro, aqui
     * mide carga. Un dia con seis cosas pendientes esta igual de lleno que uno con seis cerradas, y
     * el mapa tiene que verse igual de lleno en los dos casos — si no, un dia por venir con todo
     * agendado se veria vacio, que es justo el dia del que hay que enterarse antes de que llegue.
     *
     * Agrupa por `due_date` por lo mismo que las otras dos: es el dia LOCAL que mando el cliente.
     */
    async plannedByDay(userId, { from, to, workspaceId = null }) {
      // Acotada a un espacio cuenta el espacio ENTERO, no tu parte de el. Ver `spanning`.
      const scope = spanning(userId, workspaceId)
      return db
        .prepare(`SELECT due_date AS date, COUNT(*) AS planned FROM tasks
          WHERE ${scope.sql}
            AND due_date IS NOT NULL
            AND due_date >= ?
            AND due_date <= ?
          GROUP BY due_date`)
        .all(...scope.binds, from, to)
    },

    /**
     * Cuanto trabajo cerrado hay en una ventana, partido por dia, area y tamaño.
     *
     * Agrupa por `due_date` por lo mismo que `doneByDay`, y devuelve filas crudas sin `toDomain`:
     * esto no son tareas, son conteos. `minutes` viaja en el GROUP BY para que quien pliegue pueda
     * resolver los minutos de cada grupo — es nullable, y ahi null significa "usa lo que sugiere el
     * tamaño", que es una regla de dominio y no de SQL.
     */
    async doneStats(userId, { from, to, workspaceId = null }) {
      // Igual que `plannedByDay`: dentro de un espacio se cuenta el trabajo de todos sus miembros.
      const scope = spanning(userId, workspaceId)
      return db
        .prepare(`SELECT due_date AS date, focus_area AS focusArea, size, minutes, COUNT(*) AS done
          FROM tasks
          WHERE ${scope.sql}
            AND status = 'done'
            AND due_date IS NOT NULL
            AND due_date >= ?
            AND due_date <= ?
          GROUP BY due_date, focus_area, size, minutes`)
        .all(...scope.binds, from, to)
    },

    async countByStatus(userId) {
      return counts.all(userId)
    },

    /**
     * `backlog` es una fecha y significa "lo que quedo atras": vencido O sin agendar.
     *
     * Los dos casos van en el MISMO filtro a proposito. Sin esto, una tarea pendiente de ayer no
     * salia en ninguna pantalla de la app —`date` compara igualdad exacta— y una con `due_date`
     * nulo tampoco existia en ningun sitio, aunque el API siempre dejo crearla. Son el mismo
     * agujero visto de dos formas y la pantalla que los muestra es una sola.
     *
     * **El ORDER BY tiene `position` antes de `due_at`, y eso es deliberado.** Los tres casos:
     *
     * - Dia nunca reordenado: todas con position NULL, asi que `position IS NULL` vale 1 para todas,
     *   empatan, y el orden cae al derivado de siempre (hora, luego id). Identico a antes.
     * - Dia reordenado: `orderTasks` asigna position a TODAS las del dia, asi que manda position.
     * - Tarea nueva en un dia ya reordenado: position NULL -> 1 -> baja al final de las pendientes.
     *   Que es lo correcto: lo que acabas de anotar no se cuela en medio de un orden que tu pusiste.
     *
     * `status = 'done'` sigue primero: lo cerrado baja aunque tenga posicion.
     *
     * Consecuencia que hay que saber: esta lista YA NO llega ordenada por reloj, asi que quien
     * necesite "la mas proxima" tiene que ordenar por `dueAt` explicitamente en vez de tomar la
     * primera. Es lo que hacen `getToday` y `next-up.tsx` desde este cambio.
     */
    // `backlog` cae en null y no en undefined: node:sqlite no liga undefined, y quien llama sin el
    // filtro (getToday) lo omite del objeto.
    async listByUser(userId, { status, date, focusArea, workspaceId = null, backlog = null } = {}) {
      /**
       * DOS alcances, y la diferencia entre ellos es la decision de producto entera.
       *
       * - **Sin espacio**: `user_id = ?`, exactamente como siempre. El modo general de la app no
       *   cambia, y con el se quedan igual el widget de iOS, la Live Activity, `/me/today` y la racha.
       *   Abrir esto seria llenarle el dia a alguien con trabajo de sus compañeros sin haberlo pedido.
       * - **Con espacio**: todo lo que vive ahi, sea de quien sea, si eres miembro. Es el unico sitio
       *   donde la lista se comparte, y es justo el que la persona abrio a proposito.
       *
       * El SQL se arma en dos ramas en vez de con un `CASE`: aqui `db.prepare` corre por llamada (no
       * es un statement cacheado), y dos textos claros valen mas que un predicado que hay que leer
       * tres veces para saber a quien deja pasar.
       */
      const scope = workspaceId
        ? `tasks.workspace_id = ?
           AND EXISTS (SELECT 1 FROM workspace_members m
                        WHERE m.workspace_id = tasks.workspace_id AND m.user_id = ?)`
        : 'tasks.user_id = ?'
      const scopeBinds = workspaceId ? [workspaceId, userId] : [userId]

      // Los demas filtros son opcionales: `? IS NULL OR columna = ?` evita armar SQL a mano.
      // El bind del cronometro va PRIMERO, antes que los del alcance: ver `TIMED`.
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM tasks ${TIMED} ${TAGGED}
          WHERE ${scope}
            AND (? IS NULL OR tasks.status = ?)
            AND (? IS NULL OR tasks.due_date = ?)
            AND (? IS NULL OR tasks.focus_area = ?)
            AND (? IS NULL OR tasks.due_date < ? OR tasks.due_date IS NULL)
          ORDER BY tasks.status = 'done', tasks.position IS NULL, tasks.position,
                   tasks.due_at IS NULL, tasks.due_at, tasks.id`)
        .all(userId, ...scopeBinds, status, status, date, date, focusArea, focusArea, backlog, backlog)
      return rows.map(toDomain)
    },

    async update(userId, id, task) {
      patch.run(
        task.title, task.notes, task.size, task.minutes, task.status, task.focusArea,
        task.icon ?? null,
        task.dueAt, task.dueDate, task.completedAt, task.completedBy, task.workspaceId,
        ...seen(userId), Number(id)
      )
      return toDomain(byId.get(userId, ...seen(userId), Number(id)))
    },

    /** Cuales de estos ids puede tocar. Devuelve un Set para que quien valide compare barato. */
    async visibleIds(userId, ids) {
      if (!ids.length) return new Set()
      return new Set(
        visibleIn(ids.length)
          .all(...seen(userId), ...ids.map(Number))
          .map((row) => row.id)
      )
    },

    /**
     * Escribe el orden de una lista completa: la posicion de cada id es su indice.
     *
     * En una transaccion porque a medio camino la lista quedaria con posiciones duplicadas y el
     * ORDER BY desempataria por id, o sea que el usuario veria un orden que no puso. Quien llama ya
     * comprobo que todos los ids los puede tocar.
     */
    async setPositions(userId, ids) {
      inTransaction(() => ids.forEach((id, i) => setPosition.run(i, ...seen(userId), Number(id))))
    },

    /**
     * Arranca o para TU cronometro en esa tarea. Quien llama ya comprobo con `findById` que la puede
     * ver, asi que aqui no hay filtro de propiedad: la fila es de la pareja (tarea, persona).
     */
    async setTimer(userId, id, { startedAt, elapsedSeconds }) {
      setTimer.run(Number(id), userId, startedAt, elapsedSeconds)
      return toDomain(byId.get(userId, ...seen(userId), Number(id)))
    },

    async remove(userId, id) {
      return del.run(...seen(userId), Number(id)).changes > 0
    },
  }
}
