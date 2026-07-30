import { readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url)

const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort()

/**
 * Compara los archivos de migrations/ contra lo que knex registro en la base.
 *
 * Los dos lados importan y fallan distinto: faltan migraciones = arrancaste sin migrar y
 * vas a reventar con un `SQL logic error` cripto en la primera consulta; sobran = estas en
 * un checkout viejo contra una base nueva, que es peor porque a veces medio funciona.
 */
function assertMigrated(db, path) {
  const registered = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knex_migrations'")
    .get()
  const applied = new Set(
    registered ? db.prepare('SELECT name FROM knex_migrations').all().map((r) => r.name) : []
  )
  const files = migrationFiles()

  const pending = files.filter((name) => !applied.has(name))
  if (pending.length) {
    throw new Error(
      `Base sin migrar (${path}): faltan ${pending.join(', ')}. Corre npm run db:migrate`
    )
  }

  const unknown = [...applied].filter((name) => !files.includes(name))
  if (unknown.length) {
    throw new Error(
      `La base (${path}) trae migraciones que este codigo no conoce: ${unknown.join(', ')}. ` +
        `Actualiza el codigo o apunta DB_PATH a otra base.`
    )
  }
}

/**
 * Abre la base. NO crea esquema: eso es trabajo de las migraciones (npm run db:migrate).
 * Dos fuentes de verdad del esquema es drift garantizado.
 */
export function openDatabase(path) {
  // El timeout espera si una migracion esta escribiendo, en vez de tronar con SQLITE_BUSY.
  const db = new DatabaseSync(path, { timeout: 5000 })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  try {
    assertMigrated(db, path)
  } catch (error) {
    db.close()
    throw error
  }

  return db
}
