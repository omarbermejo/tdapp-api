/**
 * Codigos de un uso. El PK compuesto (user_id, purpose) es a la vez el indice del lookup y el
 * invariante "un solo codigo activo por proposito": emitir hace upsert y el anterior desaparece.
 *
 * No hay `consumed_at`: consumido = fila borrada, asi la tabla no crece ni pide limpieza.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE otp_codes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, purpose)
  )`)
}

export async function down(knex) {
  await knex.raw('DROP TABLE otp_codes')
}
