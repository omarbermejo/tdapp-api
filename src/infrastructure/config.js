const required = (key) => {
  const value = process.env[key]
  if (!value) throw new Error(`Falta ${key} en .env (copia .env.example)`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? 'data.db',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // Los client IDs de Google que aceptamos en el aud del idToken (iOS, Android, web).
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
}
