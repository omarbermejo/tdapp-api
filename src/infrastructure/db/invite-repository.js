const COLUMNS = `code, workspace_id AS workspaceId, invited_by AS invitedBy, email,
                 expires_at AS expiresAt, created_at AS createdAt`

export function createInviteRepository(db) {
  /**
   * El TTL se calcula en SQL con `datetime('now', '+N days')` y no en JavaScript, por lo mismo que el
   * OTP: `datetime()` de SQLite es UTC sin sufijo, y comparar contra un ISO de Node mezcla dos relojes.
   */
  const insert = db.prepare(`INSERT INTO workspace_invites (code, workspace_id, invited_by, email, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', ?))`)

  /** La expiracion se resuelve aqui y no en el dominio, por la misma razon que el TTL. */
  const byCode = db.prepare(`SELECT ${COLUMNS}, expires_at < datetime('now') AS expired
    FROM workspace_invites WHERE code = ?`)

  const byWorkspace = db.prepare(`SELECT ${COLUMNS} FROM workspace_invites
    WHERE workspace_id = ? AND expires_at >= datetime('now')
    ORDER BY created_at DESC`)

  const countLive = db.prepare(`SELECT COUNT(*) AS n FROM workspace_invites
    WHERE workspace_id = ? AND expires_at >= datetime('now')`)

  /** Consumido = fila borrada, igual que en los OTP: no hay estado "usado" que limpiar despues. */
  const del = db.prepare('DELETE FROM workspace_invites WHERE code = ?')

  /**
   * Revocar lleva los DOS parametros a proposito.
   *
   * Con `WHERE code = ?` a secas, el dueño del espacio A podria borrar una invitacion del espacio B
   * con solo conocer su codigo — y conocerlo es facil, porque los codigos se comparten.
   */
  const delIn = db.prepare('DELETE FROM workspace_invites WHERE workspace_id = ? AND code = ?')

  /** Las vencidas se barren al crear una nueva: no hace falta un cron para una tabla de este tamaño. */
  const sweep = db.prepare(`DELETE FROM workspace_invites WHERE expires_at < datetime('now')`)

  /** Una invitacion viva para ese correo en ese espacio. Reinvitar no debe dejar dos codigos vivos. */
  const liveFor = db.prepare(`SELECT ${COLUMNS} FROM workspace_invites
    WHERE workspace_id = ? AND email = ? AND expires_at >= datetime('now')
    LIMIT 1`)

  return {
    async create({ code, workspaceId, invitedBy, email, ttlDays }) {
      insert.run(code, Number(workspaceId), Number(invitedBy), email ?? null, `+${ttlDays} days`)
      return byCode.get(code)
    },

    async findByCode(code) {
      const row = byCode.get(code)
      return row && { ...row, expired: !!row.expired }
    },

    async listOf(workspaceId) {
      return byWorkspace.all(Number(workspaceId))
    },

    async countLive(workspaceId) {
      return countLive.get(Number(workspaceId)).n
    },

    async liveFor(workspaceId, email) {
      return liveFor.get(Number(workspaceId), email)
    },

    async remove(code) {
      return del.run(code).changes > 0
    },

    async removeIn(workspaceId, code) {
      return delIn.run(Number(workspaceId), code).changes > 0
    },

    async sweepExpired() {
      return sweep.run().changes
    },
  }
}
