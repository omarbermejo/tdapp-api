/**
 * Un codigo activo por (usuario, proposito): el PK compuesto lo impone y el upsert lo renueva
 * en un solo statement atomico, dejando el anterior invalido y los intentos en cero.
 *
 * La expiracion y la edad se calculan en SQL a proposito: datetime() de SQLite es UTC sin
 * sufijo Z, y new Date() en JS lo leeria como hora local (6 horas de diferencia aqui).
 */
const toDomain = (row) =>
  row && {
    codeHash: row.code_hash,
    attempts: row.attempts,
    expired: !!row.expired,
    ageSeconds: row.age_seconds,
  }

export function createOtpRepository(db) {
  const upsert = db.prepare(
    `INSERT INTO otp_codes (user_id, purpose, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, datetime('now', ?), 0, datetime('now'))
     ON CONFLICT(user_id, purpose) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       created_at = excluded.created_at`
  )
  const byPurpose = db.prepare(
    `SELECT code_hash,
            attempts,
            expires_at < datetime('now') AS expired,
            strftime('%s', 'now') - strftime('%s', created_at) AS age_seconds
       FROM otp_codes
      WHERE user_id = ? AND purpose = ?`
  )
  const bump = db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?')
  const del = db.prepare('DELETE FROM otp_codes WHERE user_id = ? AND purpose = ?')

  return {
    async issue(userId, purpose, { codeHash, ttlMinutes }) {
      upsert.run(userId, purpose, codeHash, `${ttlMinutes} minutes`)
    },
    async find(userId, purpose) {
      return toDomain(byPurpose.get(userId, purpose))
    },
    async addAttempt(userId, purpose) {
      bump.run(userId, purpose)
    },
    /** Consumido = borrado: la tabla no crece y no hace falta limpiarla. */
    async remove(userId, purpose) {
      del.run(userId, purpose)
    },
  }
}
