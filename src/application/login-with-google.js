import { createUser, toPublicUser } from '../domain/user.js'

// ponytail: sin columna google_id ni tabla de proveedores. El email verificado por Google ES la identidad,
// una cuenta por correo. Si algun dia entra un segundo proveedor, ahi se agrega la tabla.
const PLACEHOLDER_PASSWORD = 'google-oauth'

// Hash imposible a proposito: password-hasher.verify siempre falla contra esto,
// asi que una cuenta creada con Google no se puede abrir con /auth/login.
const NO_PASSWORD = 'google'

export const loginWithGoogle =
  ({ users, tokens, google }) =>
  async ({ idToken } = {}) => {
    const { email, name } = await google.verify(idToken)

    let row = await users.findByEmail(email)
    if (!row) {
      const { password, ...user } = createUser({ email, name, password: PLACEHOLDER_PASSWORD })
      row = await users.create({ ...user, passwordHash: NO_PASSWORD })
    }

    const publicUser = toPublicUser(row)
    return { user: publicUser, token: tokens.issue(publicUser) }
  }
