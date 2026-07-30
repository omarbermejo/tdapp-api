import { DatabaseSync } from 'node:sqlite'

// ponytail: node:sqlite de stdlib, cero infra. Cambiar a Postgres cuando haya mas de una instancia.
export function openDatabase(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(`CREATE TABLE IF NOT EXISTS users (
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

  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
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
  // El widget y /me/today filtran por (usuario, dia); sin este indice cada consulta es un scan.
  db.exec('CREATE INDEX IF NOT EXISTS tasks_user_date ON tasks(user_id, due_date)')

  db.exec(`CREATE TABLE IF NOT EXISTS devices (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    platform   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  return db
}
