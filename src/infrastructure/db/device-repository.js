const toDomain = (row) =>
  row && {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform,
    createdAt: row.created_at,
  }

export function createDeviceRepository(db) {
  // Si el token ya existe se reasigna: un telefono prestado no sigue recibiendo lo del dueño anterior.
  const upsert = db.prepare(`INSERT INTO devices (user_id, token, platform) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`)
  const byToken = db.prepare('SELECT id, user_id, token, platform, created_at FROM devices WHERE token = ?')
  const byUser = db.prepare('SELECT id, user_id, token, platform, created_at FROM devices WHERE user_id = ?')

  return {
    async upsert(userId, device) {
      upsert.run(userId, device.token, device.platform)
      return toDomain(byToken.get(device.token))
    },
    async listByUser(userId) {
      return byUser.all(userId).map(toDomain)
    },
  }
}
