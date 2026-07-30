/**
 * Knex vive aqui SOLO para correr migraciones: es devDependency y el API nunca lo importa.
 * En runtime el esquema se lee y se escribe con node:sqlite (src/infrastructure/db/sqlite.js).
 */
export default {
  client: 'better-sqlite3',
  connection: { filename: process.env.DB_PATH ?? 'data.db' },
  useNullAsDefault: true,
  migrations: { directory: './migrations' },
  pool: {
    afterCreate: (conn, done) => {
      // Las FKs no vienen prendidas por conexion y estas migraciones mueven datos entre tablas.
      conn.pragma('foreign_keys = ON')
      // El API puede estar escribiendo en el WAL cuando alguien corre la migracion.
      conn.pragma('busy_timeout = 5000')
      done()
    },
  },
}
