const COLUMNS = `id, user_id, title, notes, size, minutes, status, focus_area, due_at, due_date,
                 started_at, elapsed_seconds, completed_at, created_at`

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
  }

export function createTaskRepository(db) {
  const insert = db.prepare(`INSERT INTO tasks
    (user_id, title, notes, size, minutes, status, focus_area, due_at, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const byId = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE user_id = ? AND id = ?`)
  const running = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE user_id = ? AND started_at IS NOT NULL LIMIT 1`)
  const del = db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?')
  const setTimer = db.prepare('UPDATE tasks SET started_at = ?, elapsed_seconds = ? WHERE user_id = ? AND id = ?')
  const patch = db.prepare(`UPDATE tasks SET
    title = ?, notes = ?, size = ?, minutes = ?, status = ?, focus_area = ?,
    due_at = ?, due_date = ?, completed_at = ?
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

  return {
    async create(userId, task) {
      const { lastInsertRowid } = insert.run(
        userId, task.title, task.notes, task.size, task.minutes, task.status,
        task.focusArea, task.dueAt, task.dueDate
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
     * Cuanto trabajo cerrado hay en una ventana, partido por dia, area y tamaño.
     *
     * Agrupa por `due_date` por lo mismo que `doneByDay`, y devuelve filas crudas sin `toDomain`:
     * esto no son tareas, son conteos. `minutes` viaja en el GROUP BY para que quien pliegue pueda
     * resolver los minutos de cada grupo — es nullable, y ahi null significa "usa lo que sugiere el
     * tamaño", que es una regla de dominio y no de SQL.
     */
    async doneStats(userId, { from, to }) {
      return db
        .prepare(`SELECT due_date AS date, focus_area AS focusArea, size, minutes, COUNT(*) AS done
          FROM tasks
          WHERE user_id = ?
            AND status = 'done'
            AND due_date IS NOT NULL
            AND due_date >= ?
            AND due_date <= ?
          GROUP BY due_date, focus_area, size, minutes`)
        .all(userId, from, to)
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
     */
    // `backlog` cae en null y no en undefined: node:sqlite no liga undefined, y quien llama sin el
    // filtro (getToday) lo omite del objeto.
    async listByUser(userId, { status, date, focusArea, backlog = null } = {}) {
      // Los filtros son opcionales: `? IS NULL OR columna = ?` evita armar SQL a mano.
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM tasks
          WHERE user_id = ?
            AND (? IS NULL OR status = ?)
            AND (? IS NULL OR due_date = ?)
            AND (? IS NULL OR focus_area = ?)
            AND (? IS NULL OR due_date < ? OR due_date IS NULL)
          ORDER BY status = 'done', due_at IS NULL, due_at, id`)
        .all(userId, status, status, date, date, focusArea, focusArea, backlog, backlog)
      return rows.map(toDomain)
    },

    async update(userId, id, task) {
      patch.run(
        task.title, task.notes, task.size, task.minutes, task.status, task.focusArea,
        task.dueAt, task.dueDate, task.completedAt, userId, Number(id)
      )
      return toDomain(byId.get(userId, Number(id)))
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
