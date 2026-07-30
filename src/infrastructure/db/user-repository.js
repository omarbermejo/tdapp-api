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
    authProvider: row.auth_provider,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    birthDate: row.birth_date,
    focusAreas: row.focus_areas ? JSON.parse(row.focus_areas) : null,
    peakEnergy: row.peak_energy,
    reminderStyle: row.reminder_style,
    reminderHour: row.reminder_hour,
    accentColor: row.accent_color,
    onboardedAt: row.onboarded_at,
  }

// Un solo JOIN y no dos queries: findById corre en cada request autenticado y es por PK.
const SELECT = `SELECT u.id, u.email, u.name, u.password_hash, u.auth_provider,
                       u.email_verified_at, u.created_at,
                       p.birth_date, p.focus_areas, p.peak_energy,
                       p.reminder_style, p.reminder_hour, p.accent_color, p.onboarded_at
                  FROM users u
                  LEFT JOIN user_profiles p ON p.user_id = u.id`

/**
 * Las columnas del perfil, en el mismo orden que profileValues: de aqui salen la lista, los
 * placeholders y el SET del upsert, asi que agregar una columna es tocar estas dos cosas
 * pegadas y no cuatro SQL sueltos donde olvidar una borra el dato sin error.
 */
const PROFILE_COLUMNS = ['birth_date', 'focus_areas', 'peak_energy', 'reminder_style', 'reminder_hour', 'accent_color']

const profileValues = (profile) => [
  profile.birthDate,
  JSON.stringify(profile.focusAreas),
  profile.peakEnergy,
  profile.reminderStyle,
  profile.reminderHour,
  profile.accentColor,
]

const COLUMNS = PROFILE_COLUMNS.join(', ')
const PLACEHOLDERS = PROFILE_COLUMNS.map(() => '?').join(', ')
const FROM_EXCLUDED = PROFILE_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')

export function createUserRepository(db) {
  const byEmail = db.prepare(`${SELECT} WHERE u.email = ?`)
  const byId = db.prepare(`${SELECT} WHERE u.id = ?`)

  // La fecha se genera en SQL como en el resto de la tabla: un solo reloj, el de SQLite.
  const insertUser = db.prepare(
    `INSERT INTO users (email, name, password_hash, auth_provider, email_verified_at)
     VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END)`
  )
  const insertProfile = db.prepare(
    `INSERT INTO user_profiles (user_id, ${COLUMNS}) VALUES (?, ${PLACEHOLDERS})`
  )
  // onboarded_at con COALESCE: la primera vez se sella, las ediciones posteriores no lo mueven.
  const upsertProfile = db.prepare(
    `INSERT INTO user_profiles (user_id, ${COLUMNS}, onboarded_at)
     VALUES (?, ${PLACEHOLDERS}, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET ${FROM_EXCLUDED},
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
    async create({ email, name, passwordHash, authProvider = 'password', emailVerified = false, profile }) {
      return inTransaction(() => {
        const { lastInsertRowid } = insertUser.run(
          email,
          name,
          passwordHash,
          authProvider,
          emailVerified ? 1 : 0
        )
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
