import { rmSync } from 'node:fs'

import knexLib from 'knex'

import knexfile from '../../knexfile.js'

const FILES = (name) => [name, `${name}-wal`, `${name}-shm`]

/**
 * Borra la base del test y le aplica todas las migraciones.
 * Cada archivo de test usa su propio nombre y node:test corre los archivos en procesos
 * separados, asi que no hay contencion entre ellos.
 */
export async function freshDb(filename) {
  dropDb(filename)
  const knex = knexLib({ ...knexfile, connection: { filename } })
  try {
    await knex.migrate.latest()
  } finally {
    await knex.destroy()
  }
}

export function dropDb(filename) {
  for (const file of FILES(filename)) rmSync(file, { force: true })
}
