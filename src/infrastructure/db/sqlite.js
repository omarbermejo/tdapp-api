import { DatabaseSync } from 'node:sqlite'

// Las tablas que crea la ultima migracion aplicada. Es el canario de "esta base esta al dia".
const EXPECTED = ['user_profiles', 'otp_codes']

/**
 * Abre la base. NO crea esquema: eso es trabajo de las migraciones (npm run db:migrate).
 * Dos fuentes de verdad del esquema es drift garantizado.
 *
 * ponytail: el guard cuenta tablas en vez de leer knex_migrations. Techo: no detecta una
 * migracion nueva que solo agregue columnas. Camino: comparar contra knex_migrations.
 */
export function openDatabase(path) {
  // El timeout espera si una migracion esta escribiendo, en vez de tronar con SQLITE_BUSY.
  const db = new DatabaseSync(path, { timeout: 5000 })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  const placeholders = EXPECTED.map(() => '?').join(', ')
  const { found } = db
    .prepare(`SELECT count(*) AS found FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .get(...EXPECTED)

  if (found < EXPECTED.length) {
    db.close()
    throw new Error(`Base sin migrar (${path}): corre npm run db:migrate`)
  }

  return db
}
