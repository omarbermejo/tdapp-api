/**
 * Las novedades de cada persona.
 *
 * Una sola tabla y sin JOIN con `tasks`: el titulo y el espacio viajan copiados en la fila porque son
 * el estado EN EL MOMENTO del evento, no el de ahora. El unico JOIN es a `users` para el nombre de
 * quien lo hizo, y es LEFT porque esa cuenta puede haberse borrado.
 */
const SELECT = `SELECT e.id, e.kind, e.task_id, e.task_title, e.workspace_id, e.meta,
                       e.actor_id, e.created_at, e.read_at, u.name AS actor_name
                  FROM task_events e
                  LEFT JOIN users u ON u.id = e.actor_id`

const toDomain = (row) =>
  row && {
    id: row.id,
    kind: row.kind,
    taskId: row.task_id,
    taskTitle: row.task_title,
    workspaceId: row.workspace_id,
    meta: row.meta,
    actorId: row.actor_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
    readAt: row.read_at,
  }

export function createEventRepository(db) {
  const insert = db.prepare(`INSERT INTO task_events
    (user_id, actor_id, task_id, workspace_id, kind, task_title, meta, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  /**
   * La pagina del feed. `before` es el cursor: el id de la fila mas vieja que ya se pinto.
   *
   * Por `id` DESC y no por `created_at`: dos eventos del mismo segundo tienen la misma marca de
   * tiempo y el orden entre ellos seria indefinido, con lo que la paginacion podria repetir uno y
   * saltarse otro. El id es monotono y unico — por eso la tabla lleva AUTOINCREMENT.
   */
  const page = db.prepare(`${SELECT}
    WHERE e.user_id = ? AND (? IS NULL OR e.id < ?)
    ORDER BY e.id DESC LIMIT ?`)

  /** Lo que llego DESPUES de un id. Es como el cliente rellena el hueco tras reconectar. */
  const since = db.prepare(`${SELECT} WHERE e.user_id = ? AND e.id > ? ORDER BY e.id DESC LIMIT ?`)

  const byId = db.prepare(`${SELECT} WHERE e.id = ?`)

  /**
   * El globo de la campana.
   *
   * Solo cuenta lo que hizo OTRA persona: `record-event` estampa `read_at` de entrada cuando el actor
   * eres tu, asi que en el espacio personal el contador vive en cero. Sin eso la campana nace con un
   * globo permanente despues de cualquier toque, que es la forma mas rapida de aprender a ignorarla.
   */
  const unread = db.prepare('SELECT COUNT(*) AS n FROM task_events WHERE user_id = ? AND read_at IS NULL')

  const readAll = db.prepare("UPDATE task_events SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
  const readOne = db.prepare("UPDATE task_events SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL")

  return {
    async add(event) {
      const { lastInsertRowid } = insert.run(
        event.userId,
        // node:sqlite no liga undefined: todos los opcionales caen a null explicito.
        event.actorId ?? null,
        event.taskId ?? null,
        event.workspaceId ?? null,
        event.kind,
        event.taskTitle,
        event.meta ? JSON.stringify(event.meta) : null,
        event.createdAt,
        event.readAt ?? null
      )
      return toDomain(byId.get(Number(lastInsertRowid)))
    },

    async list(userId, { before = null, limit = 30 } = {}) {
      return page.all(userId, before, before, limit).map(toDomain)
    },

    async listSince(userId, id, limit = 100) {
      return since.all(userId, id, limit).map(toDomain)
    },

    async unreadCount(userId) {
      return unread.get(userId).n
    },

    /** Devuelve cuantas quedaron marcadas: 0 significa que ya estaban leidas, no que fallara. */
    async markRead(userId, id = null) {
      const at = new Date().toISOString()
      return id == null ? readAll.run(at, userId).changes : readOne.run(at, userId, Number(id)).changes
    },
  }
}
