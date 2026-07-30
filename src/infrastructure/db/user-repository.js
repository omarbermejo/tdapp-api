/**
 * `focusAreas` queda en null (no en []) cuando el LEFT JOIN no trajo fila de perfil:
 * asi toPublicUser distingue "sin perfil" y aplica los defaults en un solo lugar.
 */
const toDomain = (row) =>
  row && {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    birthYear: row.birth_year,
    diagnosis: row.diagnosis,
    treatment: row.treatment,
    focusAreas: row.focus_areas ? JSON.parse(row.focus_areas) : null,
    peakEnergy: row.peak_energy,
    reminderStyle: row.reminder_style,
    accentColor: row.accent_color,
    onboardedAt: row.onboarded_at,
  }

// Un solo JOIN y no dos queries: findById corre en cada request autenticado y es por PK.
const SELECT = `SELECT u.id, u.email, u.name, u.password_hash, u.email_verified_at, u.created_at,
                       p.birth_year, p.diagnosis, p.treatment, p.focus_areas, p.peak_energy,
                       p.reminder_style, p.accent_color, p.onboarded_at
                  FROM users u
                  LEFT JOIN user_profiles p ON p.user_id = u.id`

const PROFILE_COLUMNS = `birth_year, diagnosis, treatment, focus_areas, peak_energy, reminder_style, accent_color`

const profileValues = (profile) => [
  profile.birthYear,
  profile.diagnosis,
  profile.treatment,
  JSON.stringify(profile.focusAreas),
  profile.peakEnergy,
  profile.reminderStyle,
  profile.accentColor,
]

export function createUserRepository(db) {
  const byEmail = db.prepare(`${SELECT} WHERE u.email = ?`)
  const byId = db.prepare(`${SELECT} WHERE u.id = ?`)

  // La fecha se genera en SQL como en el resto de la tabla: un solo reloj, el de SQLite.
  const insertUser = db.prepare(
    `INSERT INTO users (email, name, password_hash, email_verified_at)
     VALUES (?, ?, ?, CASE WHEN ? THEN datetime('now') END)`
  )
  const insertProfile = db.prepare(
    `INSERT INTO user_profiles (user_id, ${PROFILE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  // onboarded_at con COALESCE: la primera vez se sella, las ediciones posteriores no lo mueven.
  const upsertProfile = db.prepare(
    `INSERT INTO user_profiles (user_id, ${PROFILE_COLUMNS}, onboarded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       birth_year = excluded.birth_year, diagnosis = excluded.diagnosis,
       treatment = excluded.treatment, focus_areas = excluded.focus_areas,
       peak_energy = excluded.peak_energy, reminder_style = excluded.reminder_style,
       accent_color = excluded.accent_color,
       onboarded_at = COALESCE(user_profiles.onboarded_at, excluded.onboarded_at)`
  )
  const touch = db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?")
  const verify = db.prepare(
    "UPDATE users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  )
  const credentials = db.prepare(
    "UPDATE users SET name = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  )

  // node:sqlite no trae helper de transaccion: se hace a mano y siempre con ROLLBACK en el catch.
  const inTransaction = (work) => {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    async findByEmail(email) {
      return toDomain(byEmail.get(email))
    },

    async findById(id) {
      return toDomain(byId.get(id))
    },

    /** Identidad y perfil nacen juntos: leer siempre encuentra las dos filas. */
    async create({ email, name, passwordHash, emailVerified = false, profile }) {
      return inTransaction(() => {
        const { lastInsertRowid } = insertUser.run(email, name, passwordHash, emailVerified ? 1 : 0)
        const id = Number(lastInsertRowid)
        insertProfile.run(id, ...profileValues(profile))
        return toDomain(byId.get(id))
      })
    },

    async markEmailVerified(id) {
      verify.run(id)
      return toDomain(byId.get(id))
    },

    async saveProfile(id, profile) {
      return inTransaction(() => {
        upsertProfile.run(id, ...profileValues(profile))
        touch.run(id)
        return toDomain(byId.get(id))
      })
    },

    /** Solo para cuentas sin verificar: quien registra otra vez ese correo se queda con ellas. */
    async replaceCredentials(id, { name, passwordHash }) {
      credentials.run(name, passwordHash, id)
      return toDomain(byId.get(id))
    },
  }
}
