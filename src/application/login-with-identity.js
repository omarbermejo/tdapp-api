import { DEFAULT_PROFILE, createIdentity, toPublicUser } from '../domain/user.js'

// ponytail: sin tabla user_identities. El correo verificado por el proveedor ES la identidad,
// una cuenta por correo. Si algun dia hay que enlazar dos proveedores a una cuenta, ahi va.
const PLACEHOLDER_PASSWORD = 'oauth-sin-password'

// Hash imposible a proposito: password-hasher.verify siempre falla contra esto. Es defensa
// en profundidad, no la fuente de verdad — quien decide es users.auth_provider.
const NO_PASSWORD = 'oauth'

/**
 * Google y Apple hacen exactamente lo mismo: verificar el token del proveedor y entrar,
 * creando la cuenta si el correo es nuevo. Lo unico que cambia es quien verifica.
 *
 * La cuenta nace con el correo ya verificado (los verifiers exigen email_verified del IdP),
 * asi que se salta el codigo — pero NO el onboarding: el proveedor da nombre y correo, y
 * ninguno de los siete campos del perfil TDAH. Eso lo sigue eligiendo la persona.
 */
export const loginWithIdentity =
  ({ users, tokens }, verifier, authProvider) =>
  async ({ idToken, name } = {}) => {
    const identity = await verifier.verify(idToken, name)

    let row = await users.findByEmail(identity.email)
    if (!row) {
      const { password, ...account } = createIdentity({ ...identity, password: PLACEHOLDER_PASSWORD })
      row = await users.create({
        ...account,
        passwordHash: NO_PASSWORD,
        authProvider,
        emailVerified: true,
        profile: DEFAULT_PROFILE,
      })
    }

    const publicUser = toPublicUser(row)
    return { user: publicUser, token: tokens.issue(publicUser) }
  }
