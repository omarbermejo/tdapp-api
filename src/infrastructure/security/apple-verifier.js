import { createPublicKey } from 'node:crypto'

import jwt from 'jsonwebtoken'

import { UnauthorizedError } from '../../domain/errors.js'

const KEYS_URL = 'https://appleid.apple.com/auth/keys'
const ISSUER = 'https://appleid.apple.com'

/**
 * Apple no tiene un endpoint tipo tokeninfo: hay que verificar la firma contra sus llaves.
 *
 * ponytail: sin jwks-rsa. node:crypto convierte el JWK a llave publica y jsonwebtoken ya estaba aqui.
 * Techo: el cache de llaves vive en memoria del proceso, asi que cada instancia las baja una vez.
 */
export const createAppleVerifier = ({ clientIds }) => {
  let keys = []

  const keyFor = async (kid) => {
    const find = () => keys.find((k) => k.kid === kid)
    // Solo volvemos a Apple cuando aparece un kid que no conocemos (rotacion de llaves).
    if (!find()) {
      const res = await fetch(KEYS_URL)
      keys = res.ok ? ((await res.json()).keys ?? []) : []
    }
    const jwk = find()
    if (!jwk) throw UnauthorizedError('Token de Apple no valido')
    return createPublicKey({ key: jwk, format: 'jwk' })
  }

  return {
    /** `name` lo manda la app: Apple solo lo entrega en la primera autorizacion. */
    async verify(idToken, name) {
      if (typeof idToken !== 'string' || !idToken) throw UnauthorizedError('Falta el idToken de Apple')

      const header = jwt.decode(idToken, { complete: true })?.header
      if (!header?.kid) throw UnauthorizedError('Token de Apple no valido')

      let payload
      try {
        payload = jwt.verify(idToken, await keyFor(header.kid), {
          algorithms: ['RS256'],
          issuer: ISSUER,
          // aud: el token tiene que ser para NUESTRA app, no para cualquier cliente de Apple.
          audience: clientIds,
        })
      } catch {
        throw UnauthorizedError('Token de Apple no valido')
      }

      // Con "ocultar mi correo" Apple manda uno de privaterelay, que igual sirve como identidad.
      if (!payload.email || String(payload.email_verified) !== 'true') {
        throw UnauthorizedError('Apple no compartio un correo verificado')
      }

      const email = String(payload.email).toLowerCase()
      const label = (String(name ?? '').trim() || email.split('@')[0]).slice(0, 40)
      return { email, name: label.length >= 2 ? label : 'Usuario' }
    },
  }
}
