import { UnauthorizedError } from '../domain/errors.js'
import { toPublicUser } from '../domain/user.js'

export const loginUser =
  ({ users, hasher, tokens }) =>
  async ({ email, password }) => {
    const found = await users.findByEmail(typeof email === 'string' ? email.trim().toLowerCase() : '')

    // ponytail: mismo mensaje para usuario inexistente y password mala, no filtramos quien esta registrado.
    if (!found || !(await hasher.verify(typeof password === 'string' ? password : '', found.passwordHash))) {
      throw UnauthorizedError('Correo o contraseña incorrectos')
    }

    const publicUser = toPublicUser(found)
    return { user: publicUser, token: tokens.issue(publicUser) }
  }
