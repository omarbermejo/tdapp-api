import { UnauthorizedError } from '../../domain/errors.js'

// ponytail: endpoint tokeninfo de Google en vez de google-auth-library + cache de JWKS.
// Techo: un fetch extra por login (Google valida firma y expiracion por nosotros).
// Si el login se vuelve caliente, verificar la firma local con jsonwebtoken + las llaves de Google.
export const createGoogleVerifier = ({ clientIds }) => ({
  async verify(idToken) {
    if (typeof idToken !== 'string' || !idToken) throw UnauthorizedError('Falta el idToken de Google')

    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
    const payload = res.ok ? await res.json() : {}

    // aud: el token tiene que ser para NUESTRA app, no para cualquier cliente de Google.
    if (!clientIds.includes(payload.aud) || String(payload.email_verified) !== 'true' || !payload.email) {
      throw UnauthorizedError('Token de Google no valido')
    }

    const name = String(payload.name ?? payload.email.split('@')[0]).trim().slice(0, 40)
    return { email: String(payload.email).toLowerCase(), name: name.length >= 2 ? name : 'Usuario' }
  },
})
