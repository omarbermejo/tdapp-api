const COLUMNS = `id, user_id, title, notes, size, minutes, status, focus_area, due_at, due_date,
                 started_at, elapsed_seconds, completed_at, created_at, workspace_id, position`

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
    dueAt: row.due_at,
    dueDate: row.due_date,
    startedAt: row.started_at,
    elapsedSeconds: row.elapsed_seconds,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    workspaceId: row.workspace_id,
    /** null = nadie ha ordenado este dia a mano. Ver el ORDER BY de `listByUser`. */
    position: row.position,
  }

export function createTaskRepository(db) {
  // `position` NO va aqui: una tarea nueva nace sin posicion, y eso es informacion — significa que
  // nadie la ha colocado a mano, asi que cae al final del dia por el ORDER BY de `listByUser`.
  const insert = db.prepare(`INSERT INTO tasks
    (user_id, title, notes, size, minutes, status, focus_area, due_at, due_date, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const byId = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE user_id = ? AND id = ?`)
  const running = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE user_id = ? AND started_at IS NOT NULL LIMIT 1`)
  const del = db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?')
  const setTimer = db.prepare('UPDATE tasks SET started_at = ?, elapsed_seconds = ? WHERE user_id = ? AND id = ?')
  /**
   * La lista de columnas es FIJA, y `position` no esta en ella a proposito: asi un PATCH normal
   * (renombrar, marcar hecha, mover de dia) no puede pisar el orden que la persona puso a mano. Lo
   * unico que escribe `position` es `setPositions`.
   */
  const patch = db.prepare(`UPDATE tasks SET
    title = ?, notes = ?, size = ?, minutes = ?, status = ?, focus_area = ?,
    due_at = ?, due_date = ?, completed_at = ?, workspace_id = ?
    WHERE user_id = ? AND id = ?`)
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
  const setPosition = db.prepare('UPDATE tasks SET position = ? WHERE user_id = ? AND id = ?')

  /** Cuales de estos ids son de esta persona. De aqui sale la validacion de `setPositions`. */
  const ownedIn = (n) =>
    db.prepare(
      `SELECT id FROM tasks WHERE user_id = ? AND id IN (${Array.from({ length: n }, () => '?').join(', ')})`
    )

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
        task.focusArea, task.dueAt, task.dueDate, task.workspaceId
      )
      return toDomain(byId.get(userId, Number(lastInsertRowid)))
    },

    async findById(userId, id) {
      return toDomain(byId.get(userId, Number(id)))
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
      return db
        .prepare(`SELECT due_date AS date, COUNT(*) AS planned FROM tasks
          WHERE user_id = ?
            AND due_date IS NOT NULL
            AND due_date >= ?
            AND due_date <= ?
            AND (? IS NULL OR workspace_id = ?)
          GROUP BY due_date`)
        .all(userId, from, to, workspaceId, workspaceId)
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
      return db
        .prepare(`SELECT due_date AS date, focus_area AS focusArea, size, minutes, COUNT(*) AS done
          FROM tasks
          WHERE user_id = ?
            AND status = 'done'
            AND due_date IS NOT NULL
            AND due_date >= ?
            AND due_date <= ?
            AND (? IS NULL OR workspace_id = ?)
          GROUP BY due_date, focus_area, size, minutes`)
        .all(userId, from, to, workspaceId, workspaceId)
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
      // Los filtros son opcionales: `? IS NULL OR columna = ?` evita armar SQL a mano.
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM tasks
          WHERE user_id = ?
            AND (? IS NULL OR status = ?)
            AND (? IS NULL OR due_date = ?)
            AND (? IS NULL OR focus_area = ?)
            AND (? IS NULL OR workspace_id = ?)
            AND (? IS NULL OR due_date < ? OR due_date IS NULL)
          ORDER BY status = 'done', position IS NULL, position, due_at IS NULL, due_at, id`)
        .all(
          userId, status, status, date, date, focusArea, focusArea,
          workspaceId, workspaceId, backlog, backlog
        )
      return rows.map(toDomain)
    },

    async update(userId, id, task) {
      patch.run(
        task.title, task.notes, task.size, task.minutes, task.status, task.focusArea,
        task.dueAt, task.dueDate, task.completedAt, task.workspaceId, userId, Number(id)
      )
      return toDomain(byId.get(userId, Number(id)))
    },

    /** Cuales de estos ids son de esta persona. Devuelve un Set para que quien valide compare barato. */
    async ownedIds(userId, ids) {
      if (!ids.length) return new Set()
      return new Set(ownedIn(ids.length).all(userId, ...ids.map(Number)).map((row) => row.id))
    },

    /**
     * Escribe el orden de una lista completa: la posicion de cada id es su indice.
     *
     * En una transaccion porque a medio camino la lista quedaria con posiciones duplicadas y el
     * ORDER BY desempataria por id, o sea que el usuario veria un orden que no puso. Quien llama ya
     * comprobo que todos los ids son suyos.
     */
    async setPositions(userId, ids) {
      inTransaction(() => ids.forEach((id, i) => setPosition.run(i, userId, Number(id))))
    },

    async setTimer(userId, id, { startedAt, elapsedSeconds }) {
      setTimer.run(startedAt, elapsedSeconds, userId, Number(id))
      return toDomain(byId.get(userId, Number(id)))
    },

    async remove(userId, id) {
      return del.run(userId, Number(id)).changes > 0
    },
  }
}
