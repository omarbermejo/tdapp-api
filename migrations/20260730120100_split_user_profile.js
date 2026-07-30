/**
 * Parte `users` en identidad (login) y perfil (lo que se pide en onboarding).
 *
 * `users` se queda con lo que hace falta para entrar; `user_profiles` con las 7 columnas
 * que el usuario afina despues del codigo de verificacion.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE user_profiles (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    birth_year     INTEGER,
    diagnosis      TEXT NOT NULL,
    treatment      TEXT NOT NULL,
    focus_areas    TEXT NOT NULL,
    peak_energy    TEXT NOT NULL,
    reminder_style TEXT NOT NULL,
    accent_color   TEXT NOT NULL,
    onboarded_at   TEXT
  )`)

  // Los defaults del dominio son la referencia: si algo difiere, esa persona ya paso por el
  // formulario largo y no hay que volver a mandarla al onboarding.
  await knex.raw(`INSERT INTO user_profiles
    (user_id, birth_year, diagnosis, treatment, focus_areas, peak_energy, reminder_style, accent_color, onboarded_at)
    SELECT id, birth_year, diagnosis, treatment, focus_areas, peak_energy, reminder_style, accent_color,
           CASE WHEN birth_year IS NOT NULL
                  OR diagnosis <> 'undisclosed'
                  OR treatment <> 'undisclosed'
                  OR focus_areas <> '[]'
                  OR peak_energy <> 'varies'
                  OR reminder_style <> 'firm'
                THEN created_at END
      FROM users`)

  // ADD COLUMN no acepta DEFAULT (datetime('now')): "Cannot add a column with non-constant default".
  await knex.raw('ALTER TABLE users ADD COLUMN email_verified_at TEXT')
  await knex.raw('ALTER TABLE users ADD COLUMN updated_at TEXT')

  // Quien ya tenia cuenta entro cuando no existia el OTP: no se le cierra la puerta retroactivamente.
  await knex.raw('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL')

  for (const column of [
    'birth_year',
    'diagnosis',
    'treatment',
    'focus_areas',
    'peak_energy',
    'reminder_style',
    'accent_color',
  ]) {
    await knex.raw(`ALTER TABLE users DROP COLUMN ${column}`)
  }
}

export async function down() {
  throw new Error('DROP COLUMN no se revierte: restaura el archivo .db desde su copia')
}
