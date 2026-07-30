const required = (key) => {
  const value = process.env[key]
  if (!value) throw new Error(`Falta ${key} en .env (copia .env.example)`)
  return value
}

/** Lista separada por comas. Vacia = el endpoint de ese proveedor responde 401. */
const list = (key) =>
  (process.env[key] ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? 'data.db',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // Los client IDs de Google que aceptamos en el aud del idToken (iOS, Android, web).
  googleClientIds: list('GOOGLE_CLIENT_IDS'),
  // En Apple el aud es el bundle id de la app (o el Services ID si algun dia hay web).
  appleClientIds: list('APPLE_CLIENT_IDS'),
}
