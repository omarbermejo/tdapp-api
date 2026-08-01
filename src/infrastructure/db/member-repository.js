/**
 * Quien esta dentro de cada espacio.
 *
 * Las columnas de la persona salen del mismo JOIN a `user_profiles` que usa `user-repository`, porque
 * la cara y el color de alguien viven en su perfil y no en `users`. Lo que sale de aqui lo filtra
 * SIEMPRE `toPublicMember`: la fila cruda trae mas de lo que un tercero puede ver.
 */
const MEMBER_COLUMNS = `u.id, u.name, p.avatar, p.accent_color AS accentColor`

export function createMemberRepository(db) {
  const add = db.prepare(
    `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)`
  )
  const del = db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')

  const isMember = db.prepare(
    'SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1'
  )

  const countOf = db.prepare(
    'SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?'
  )

  /**
   * ¿Comparto ALGUN espacio con esta persona?
   *
   * Es el permiso que deja invitar por `personId` sin que el cliente conozca el correo de nadie: solo
   * se puede nombrar por id a quien ya sale en tu propia lista de colaboradores, asi que el endpoint no
   * se puede usar para averiguar si un id cualquiera existe.
   */
  const shares = db.prepare(`SELECT 1
      FROM workspace_members mine
      JOIN workspace_members theirs ON theirs.workspace_id = mine.workspace_id
     WHERE mine.user_id = ? AND theirs.user_id = ?
     LIMIT 1`)

  const listOf = db.prepare(`SELECT ${MEMBER_COLUMNS}, m.role, m.joined_at AS joinedAt
    FROM workspace_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE m.workspace_id = ?
    ORDER BY m.role = 'member', m.joined_at, u.id`)

  /**
   * Las personas con las que compartes algun espacio, y el espacio donde MAS han trabajado juntos.
   *
   * Tres pasos, y cada uno existe por una razon:
   *
   * - `shared` cruza la tabla consigo misma para quedarse con quien pisa alguno de mis espacios. El
   *   `<>` saca a la propia persona, que si no sale siempre la primera de su propia lista.
   * - `weighted` cuenta las tareas de cada par (persona, espacio). LEFT JOIN y no JOIN: alguien a quien
   *   acabas de meter en un espacio vacio sigue siendo un colaborador, solo que con cero.
   * - el `WHERE tasks = (SELECT MAX(...))` deja UNA fila por persona, que es lo que se pidio: "el
   *   espacio donde colaboraron juntos, solamente el que tenga mas tareas". El desempate por
   *   `workspace_id` evita que dos espacios empatados devuelvan dos filas de la misma persona.
   *
   * `userId` se liga TRES veces; el orden de los binds es el orden en que aparecen en el texto.
   */
  const collaborators = db.prepare(`
    WITH shared AS (
      SELECT theirs.workspace_id, theirs.user_id
        FROM workspace_members mine
        JOIN workspace_members theirs
          ON theirs.workspace_id = mine.workspace_id
         AND theirs.user_id <> mine.user_id
       WHERE mine.user_id = ?
    ),
    weighted AS (
      SELECT s.user_id, s.workspace_id, COUNT(t.id) AS tasks
        FROM shared s
        LEFT JOIN tasks t ON t.workspace_id = s.workspace_id
       GROUP BY s.user_id, s.workspace_id
    )
    SELECT ${MEMBER_COLUMNS},
           w.id AS workspaceId, w.name AS workspaceName,
           w.icon AS workspaceIcon, w.accent AS workspaceAccent,
           best.tasks
      FROM weighted best
      JOIN users u ON u.id = best.user_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      JOIN workspaces w ON w.id = best.workspace_id
     WHERE best.tasks = (SELECT MAX(w2.tasks) FROM weighted w2 WHERE w2.user_id = best.user_id)
       AND best.workspace_id = (
         SELECT MIN(w3.workspace_id) FROM weighted w3
          WHERE w3.user_id = best.user_id AND w3.tasks = best.tasks
       )
     ORDER BY best.tasks DESC, u.name`)

  return {
    async add(workspaceId, userId, role = 'member') {
      return add.run(Number(workspaceId), Number(userId), role).changes > 0
    },

    async remove(workspaceId, userId) {
      return del.run(Number(workspaceId), Number(userId)).changes > 0
    },

    async isMember(workspaceId, userId) {
      return !!isMember.get(Number(workspaceId), Number(userId))
    },

    async countOf(workspaceId) {
      return countOf.get(Number(workspaceId)).n
    },

    async sharesWith(userId, personId) {
      return !!shares.get(Number(userId), Number(personId))
    },

    async listOf(workspaceId) {
      return listOf.all(Number(workspaceId))
    },

    async collaboratorsOf(userId) {
      return collaborators.all(Number(userId))
    },
  }
}
