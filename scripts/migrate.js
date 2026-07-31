import { readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

/**
 * Aplica las migraciones con `node:sqlite`, sin knex y sin `better-sqlite3`.
 *
 * **Por que existe:** `better-sqlite3@13` no publica binarios precompilados (no trae `install` script ni
 * `prebuild-install`), asi que SIEMPRE compila con node-gyp — y eso necesita Python y un toolchain de C
 * en la imagen. En la Mac de desarrollo estan; en el contenedor no, y `npm ci` reventaba el build. La
 * alternativa era meter Python en la imagen para compilar en cada deploy una dependencia que el runtime
 * NO usa: el API lee y escribe con `node:sqlite` desde el principio, y `better-sqlite3` solo existia
 * para que knex pudiera migrar.
 *
 * **Por que se puede:** las 9 migraciones usan `knex.raw` (25 veces) y `knex.schema.hasTable` (3). Nada
 * mas. Asi que basta un shim de dos metodos sobre `node:sqlite` para ejecutarlas TAL CUAL, sin tocar ni
 * una — que es lo que hace que esto no sea una reescritura con riesgo, sino un runner distinto para los
 * mismos archivos.
 *
 * **Compatible con knex a proposito:** escribe en la MISMA tabla `knex_migrations` con el mismo esquema,
 * asi que `assertMigrated` (en `infrastructure/db/sqlite.js`) sigue validando igual, y `npm run db:make`
 * y `db:status` con knex siguen funcionando en desarrollo sobre una base migrada por aqui.
 */

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

/** Lo que knex crea la primera vez. Se replica exacto para que las dos herramientas se entiendan. */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS `knex_migrations` (`id` integer not null primary key autoincrement, `name` varchar(255), `batch` integer, `migration_time` datetime)',
  // `index` es palabra reservada y va entre comillas, IGUAL que lo escribe knex: renombrarla a
  // `index_` dejaba una base que knex no puede volver a tocar en desarrollo.
  'CREATE TABLE IF NOT EXISTS `knex_migrations_lock` (`index` integer not null primary key autoincrement, `is_locked` integer)',
]

/**
 * El shim de knex: solo lo que las migraciones usan de verdad.
 *
 * `raw` acepta varias sentencias en un solo template (las migraciones lo hacen), asi que va por `exec` y
 * no por `prepare` — `prepare` solo admite una.
 */
const shim = (db) => ({
  raw: async (sql) => db.exec(sql),
  schema: {
    hasTable: async (name) =>
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
  },
})

async function migrate() {
  const path = process.env.DB_PATH ?? 'data.db'
  const db = new DatabaseSync(path, { timeout: 5000 })

  db.exec('PRAGMA journal_mode = WAL')
  // Las migraciones mueven datos entre tablas, asi que las FKs tienen que estar activas.
  db.exec('PRAGMA foreign_keys = ON')
  for (const sql of SCHEMA) db.exec(sql)

  const applied = new Set(db.prepare('SELECT name FROM knex_migrations').all().map((r) => r.name))
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort()
  const pending = files.filter((name) => !applied.has(name))

  if (pending.length === 0) {
    console.log(`Sin migraciones pendientes (${applied.size} aplicadas en ${path})`)
    db.close()
    return
  }

  const batch = (db.prepare('SELECT MAX(batch) AS n FROM knex_migrations').get().n ?? 0) + 1
  const record = db.prepare(
    'INSERT INTO knex_migrations (name, batch, migration_time) VALUES (?, ?, ?)'
  )
  const knex = shim(db)

  for (const name of pending) {
    const module = await import(pathToFileURL(new URL(name, MIGRATIONS_DIR).pathname).href)
    /**
     * Cada migracion va en su propia transaccion: si la cuarta falla, las tres anteriores quedan
     * aplicadas y registradas, y al reintentar arranca desde la cuarta. A medias dentro de UNA
     * migracion es lo unico inaceptable, y eso es justo lo que la transaccion evita.
     */
    db.exec('BEGIN')
    try {
      await module.up(knex)
      record.run(name, batch, new Date().toISOString())
      db.exec('COMMIT')
      console.log(`  ✔ ${name}`)
    } catch (error) {
      db.exec('ROLLBACK')
      db.close()
      throw new Error(`Migracion ${name} fallo: ${error.message}`)
    }
  }

  console.log(`Batch ${batch}: ${pending.length} migraciones aplicadas en ${path}`)
  db.close()
}

migrate().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
