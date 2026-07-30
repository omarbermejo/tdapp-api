const toDomain = (row) =>
  row && {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    birthYear: row.birth_year,
    diagnosis: row.diagnosis,
    treatment: row.treatment,
    focusAreas: JSON.parse(row.focus_areas),
    peakEnergy: row.peak_energy,
    reminderStyle: row.reminder_style,
    accentColor: row.accent_color,
    createdAt: row.created_at,
  }

const COLUMNS = `id, email, name, password_hash, birth_year, diagnosis, treatment,
                 focus_areas, peak_energy, reminder_style, accent_color, created_at`

export function createUserRepository(db) {
  const insert = db.prepare(`INSERT INTO users
    (email, name, password_hash, birth_year, diagnosis, treatment, focus_areas, peak_energy, reminder_style, accent_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const byEmail = db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`)
  const byId = db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`)

  return {
    async findByEmail(email) {
      return toDomain(byEmail.get(email))
    },
    async findById(id) {
      return toDomain(byId.get(id))
    },
    async create(user) {
      const { lastInsertRowid } = insert.run(
        user.email,
        user.name,
        user.passwordHash,
        user.birthYear,
        user.diagnosis,
        user.treatment,
        JSON.stringify(user.focusAreas),
        user.peakEnergy,
        user.reminderStyle,
        user.accentColor
      )
      return toDomain(byId.get(Number(lastInsertRowid)))
    },
  }
}
