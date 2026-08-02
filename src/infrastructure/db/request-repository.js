/**
 * Quien ha PEDIDO entrar a un espacio y todavia espera respuesta.
 *
 * Las columnas de la persona salen del mismo JOIN a `user_profiles` que `member-repository`, y por el
 * mismo motivo: la cara y el color viven en el perfil, no en `users`. El dueño tiene que poder ver a
 * quien esta dejando entrar.
 */
const PERSON_COLUMNS = `u.id, u.name, p.avatar, p.accent_color AS accentColor`

export function createRequestRepository(db) {
  /**
   * `INSERT OR IGNORE`: tocar el enlace tres veces no son tres solicitudes.
   *
   * Y no es `OR REPLACE`: reemplazar reiniciaria `created_at`, o sea que insistir subiria la solicitud
   * al principio de la lista del dueño. Quien pidio primero sale primero.
   */
  const add = db.prepare(
    'INSERT OR IGNORE INTO workspace_requests (workspace_id, user_id, code) VALUES (?, ?, ?)'
  )
  const del = db.prepare('DELETE FROM workspace_requests WHERE workspace_id = ? AND user_id = ?')
  const findOne = db.prepare(
    'SELECT id, workspace_id AS workspaceId, user_id AS userId, code FROM workspace_requests WHERE workspace_id = ? AND user_id = ?'
  )
  const exists = db.prepare(
    'SELECT 1 FROM workspace_requests WHERE workspace_id = ? AND user_id = ? LIMIT 1'
  )

  const listOf = db.prepare(`SELECT ${PERSON_COLUMNS}, r.created_at AS askedAt
      FROM workspace_requests r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE r.workspace_id = ?
     ORDER BY r.created_at ASC`)

  /**
   * TODAS las solicitudes de los espacios que administra una persona, de una consulta.
   *
   * De una y no una por espacio: esto lo pide la pantalla de novedades en cada carga, y con N espacios
   * serian N consultas para pintar una lista que casi siempre esta vacia.
   */
  const listForOwner = db.prepare(`SELECT ${PERSON_COLUMNS}, r.created_at AS askedAt,
                                          w.id AS workspaceId, w.name AS workspaceName
      FROM workspace_requests r
      JOIN workspaces w ON w.id = r.workspace_id
      JOIN users u ON u.id = r.user_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE w.user_id = ?
     ORDER BY r.created_at ASC`)

  return {
    async add(workspaceId, userId, code) {
      return add.run(Number(workspaceId), Number(userId), code).changes > 0
    },
    async remove(workspaceId, userId) {
      return del.run(Number(workspaceId), Number(userId)).changes > 0
    },
    async find(workspaceId, userId) {
      return findOne.get(Number(workspaceId), Number(userId)) ?? null
    },
    async pending(workspaceId, userId) {
      return !!exists.get(Number(workspaceId), Number(userId))
    },
    async listOf(workspaceId) {
      return listOf.all(Number(workspaceId))
    },
    async listForOwner(userId) {
      return listForOwner.all(Number(userId))
    },
  }
}
