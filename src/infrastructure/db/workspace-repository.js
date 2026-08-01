/**
 * Las columnas propias, con los alias que hacen falta.
 *
 * `created_at AS createdAt` no es cosmetico: `toPublicWorkspace` lee `row.createdAt`, asi que sin el
 * alias devolveria `undefined` y el campo saldria vacio del API sin que nada fallara. Aqui no hay un
 * `toDomain` como en task-repository porque solo existe UNA forma de fila y los alias la resuelven
 * enteros; el dia que haya dos consultas con formas distintas, ese mapeo se promueve a funcion.
 */
const COLUMNS = 'id, user_id AS userId, name, icon, accent, position, created_at AS createdAt'

export function createWorkspaceRepository(db) {
  const insert = db.prepare(
    'INSERT INTO workspaces (user_id, name, icon, accent, position) VALUES (?, ?, ?, ?, ?)'
  )
  const byId = db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE user_id = ? AND id = ?`)
  const patch = db.prepare(
    'UPDATE workspaces SET name = ?, icon = ?, accent = ?, position = ? WHERE user_id = ? AND id = ?'
  )
  const del = db.prepare('DELETE FROM workspaces WHERE user_id = ? AND id = ?')

  /** El siguiente hueco al final. COALESCE porque MAX de cero filas es NULL, no 0. */
  const lastPosition = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS last FROM workspaces WHERE user_id = ?'
  )

  /**
   * Los espacios con su progreso, en una sola consulta.
   *
   * El conteo va en SQL y no plegando tareas en memoria porque la pantalla de inicio solo necesita
   * dos numeros por espacio: traerse las tareas para contarlas seria traer cientos de filas para
   * calcular un porcentaje.
   *
   * `SUM(t.status = 'done')` funciona porque SQLite evalua la comparacion a 1/0. El COALESCE cubre el
   * espacio sin ninguna tarea, donde el LEFT JOIN deja el SUM en NULL — y ese caso es el normal, no
   * el raro: un espacio recien creado esta vacio.
   *
   * El `AND t.user_id = w.user_id` del JOIN es redundante mientras la FK sea correcta, y se queda
   * igual: es la clase de dato que no se puede filtrar mal ni una vez.
   */
  const COUNTED = `SELECT
      w.id, w.name, w.icon, w.accent, w.position, w.created_at AS createdAt,
      COUNT(t.id) AS total,
      COALESCE(SUM(t.status = 'done'), 0) AS done
    FROM workspaces w
    LEFT JOIN tasks t ON t.workspace_id = w.id AND t.user_id = w.user_id`

  const withCounts = db.prepare(`${COUNTED}
    WHERE w.user_id = ?
    GROUP BY w.id
    ORDER BY w.position, w.id`)

  /** El mismo conteo para UNO solo: es la cabecera de la pantalla de detalle. */
  const oneWithCounts = db.prepare(`${COUNTED}
    WHERE w.user_id = ? AND w.id = ?
    GROUP BY w.id`)

  return {
    async listWithCounts(userId) {
      return withCounts.all(userId)
    },

    async findById(userId, id) {
      return byId.get(userId, Number(id))
    },

    /** Con `total` y `done`. Lo usa la pantalla de detalle; `findById` basta para validar un PATCH. */
    async findByIdWithCounts(userId, id) {
      return oneWithCounts.get(userId, Number(id))
    },

    async create(userId, workspace) {
      const { lastInsertRowid } = insert.run(
        userId,
        workspace.name,
        workspace.icon,
        workspace.accent,
        workspace.position
      )
      return byId.get(userId, Number(lastInsertRowid))
    },

    async update(userId, id, workspace) {
      patch.run(workspace.name, workspace.icon, workspace.accent, workspace.position, userId, Number(id))
      return byId.get(userId, Number(id))
    },

    async remove(userId, id) {
      // Las tareas del espacio sobreviven: la FK las deja con workspace_id = NULL (ON DELETE SET NULL).
      return del.run(userId, Number(id)).changes > 0
    },

    async nextPosition(userId) {
      return lastPosition.get(userId).last + 1
    },
  }
}
