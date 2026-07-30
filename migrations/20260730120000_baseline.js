/**
 * Baseline: el esquema tal como lo creaba openDatabase() antes de existir las migraciones.
 *
 * Es idempotente a proposito. Sobre una base que ya vivio (data.db) no toca nada y solo se
 * registra en knex_migrations; sobre una base nueva (los .db de los tests) crea todo.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('users'))) {
    await knex.raw(`CREATE TABLE users (
      id             INTEGER PRIMARY KEY,
      email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name           TEXT NOT NULL,
      password_hash  TEXT NOT NULL,
      birth_year     INTEGER,
      diagnosis      TEXT NOT NULL,
      treatment      TEXT NOT NULL,
      focus_areas    TEXT NOT NULL DEFAULT '[]',
      peak_energy    TEXT NOT NULL,
      reminder_style TEXT NOT NULL,
      accent_color   TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  }

  if (!(await knex.schema.hasTable('tasks'))) {
    await knex.raw(`CREATE TABLE tasks (
      id               INTEGER PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      notes            TEXT,
      size             TEXT NOT NULL,
      status           TEXT NOT NULL,
      focus_area       TEXT,
      due_at           TEXT,
      due_date         TEXT,
      started_at       TEXT,
      elapsed_seconds  INTEGER NOT NULL DEFAULT 0,
      completed_at     TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  }
  // El widget y /me/today filtran por (usuario, dia); sin este indice cada consulta es un scan.
  await knex.raw('CREATE INDEX IF NOT EXISTS tasks_user_date ON tasks(user_id, due_date)')

  if (!(await knex.schema.hasTable('devices'))) {
    await knex.raw(`CREATE TABLE devices (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      platform   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  }
}

export async function down() {
  throw new Error('El baseline no se revierte: restaura el archivo .db desde su copia')
}
