import { DatabaseSync } from 'node:sqlite'

// ponytail: node:sqlite de stdlib, cero infra. Cambiar a Postgres cuando haya mas de una instancia.
export function openDatabase(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
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
  return db
}
