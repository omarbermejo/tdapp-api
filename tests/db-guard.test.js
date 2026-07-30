import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test, { after } from 'node:test'

import { openDatabase } from '../src/infrastructure/db/sqlite.js'
import { dropDb, freshDb } from './helpers/db.js'

const DB = 'test-guard.db'
after(() => dropDb(DB))

test('una base sin migrar no se abre y dice que hacer', () => {
  dropDb(DB)
  new DatabaseSync(DB).close() // archivo vacio, como el de alguien que acaba de clonar

  assert.throws(() => openDatabase(DB), (error) => {
    assert.match(error.message, /Base sin migrar/)
    assert.match(error.message, /npm run db:migrate/)
    assert.match(error.message, /baseline/, 'nombra las migraciones que faltan')
    return true
  })
})

test('una base al dia se abre normal', async () => {
  await freshDb(DB)
  const db = openDatabase(DB)
  assert.ok(db.prepare('SELECT 1 AS ok').get().ok)
  db.close()
})

test('falta una sola migracion: tampoco arranca', async () => {
  await freshDb(DB)
  const last = readdirSync(new URL('../migrations/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .at(-1)

  // El caso que nos tumbo el servidor: la migracion que solo agrega una columna.
  const db = new DatabaseSync(DB)
  db.prepare('DELETE FROM knex_migrations WHERE name = ?').run(last)
  db.close()

  assert.throws(() => openDatabase(DB), new RegExp(`Base sin migrar.*${last}`, 's'))
})

test('base mas nueva que el codigo: avisa en vez de medio funcionar', async () => {
  await freshDb(DB)
  const db = new DatabaseSync(DB)
  db.prepare('INSERT INTO knex_migrations (name, batch, migration_time) VALUES (?, 99, ?)').run(
    '29990101000000_del_futuro.js',
    new Date().toISOString()
  )
  db.close()

  assert.throws(() => openDatabase(DB), /migraciones que este codigo no conoce.*del_futuro/s)
})
