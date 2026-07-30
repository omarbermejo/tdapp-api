import { DEFAULT_PROFILE, createIdentity, toPublicUser } from '../domain/user.js'

// ponytail: sin columna google_id ni apple_sub. El correo verificado por el proveedor ES la
// identidad, una cuenta por correo. Si algun dia hay que enlazar dos proveedores, ahi va la tabla.
const PLACEHOLDER_PASSWORD = 'oauth-sin-password'

// Hash imposible a proposito: password-hasher.verify siempre falla contra esto,
// asi que una cuenta creada con un proveedor no se puede abrir con /auth/login.
const NO_PASSWORD = 'oauth'

/**
 * Google y Apple hacen exactamente lo mismo: verificar el token del proveedor y entrar,
 * creando la cuenta si el correo es nuevo. Lo unico que cambia es quien verifica.
 */
export const loginWithIdentity =
  ({ users, tokens }, provider) =>
  async ({ idToken, name } = {}) => {
    const identity = await provider.verify(idToken, name)

    let row = await users.findByEmail(identity.email)
    if (!row) {
      const { password, ...account } = createIdentity({ ...identity, password: PLACEHOLDER_PASSWORD })
      row = await users.create({
        ...account,
        passwordHash: NO_PASSWORD,
        // El proveedor ya verifico el correo (los verifiers exigen email_verified), asi que
        // estas cuentas se saltan el OTP y caen directo en onboarding.
        emailVerified: true,
        profile: DEFAULT_PROFILE,
      })
    }

    const publicUser = toPublicUser(row)
    return { user: publicUser, token: tokens.issue(publicUser) }
  }
