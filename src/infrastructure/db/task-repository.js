const COLUMNS = `id, user_id, title, notes, size, status, focus_area, due_at, due_date,
                 started_at, elapsed_seconds, completed_at, created_at`

const toDomain = (row) =>
  row && {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    size: row.size,
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
    (user_id, title, notes, size, status, focus_area, due_at, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const byId = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE user_id = ? AND id = ?`)
  const running = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE user_id = ? AND started_at IS NOT NULL LIMIT 1`)
  const del = db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?')
  const setTimer = db.prepare('UPDATE tasks SET started_at = ?, elapsed_seconds = ? WHERE user_id = ? AND id = ?')
  const patch = db.prepare(`UPDATE tasks SET
    title = ?, notes = ?, size = ?, status = ?, focus_area = ?, due_at = ?, due_date = ?, completed_at = ?
    WHERE user_id = ? AND id = ?`)

  return {
    async create(userId, task) {
      const { lastInsertRowid } = insert.run(
        userId, task.title, task.notes, task.size, task.status,
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

    async listByUser(userId, { status, date, focusArea } = {}) {
      // Los filtros son opcionales: `? IS NULL OR columna = ?` evita armar SQL a mano.
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM tasks
          WHERE user_id = ?
            AND (? IS NULL OR status = ?)
            AND (? IS NULL OR due_date = ?)
            AND (? IS NULL OR focus_area = ?)
          ORDER BY status = 'done', due_at IS NULL, due_at, id`)
        .all(userId, status, status, date, date, focusArea, focusArea)
      return rows.map(toDomain)
    },

    async update(userId, id, task) {
      patch.run(
        task.title, task.notes, task.size, task.status, task.focusArea,
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
