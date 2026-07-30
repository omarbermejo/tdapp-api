import { UnauthorizedError } from '../domain/errors.js'
import { toPublicUser } from '../domain/user.js'

export const loginUser =
  ({ users, hasher, tokens }) =>
  async ({ email, password }) => {
    const found = await users.findByEmail(typeof email === 'string' ? email.trim().toLowerCase() : '')

    // Una cuenta de Google o Apple no tiene contraseña con la que entrar. Se rechaza por el
    // proveedor, que es un dato, y no por confiar en que el hash guardado sea inigualable.
    const usesPassword = found?.authProvider === 'password'

    // ponytail: mismo mensaje para usuario inexistente, proveedor distinto y password mala.
    // Decir "esta cuenta usa Google" seria mas amable pero revela que ese correo existe.
    if (
      !found ||
      !usesPassword ||
      !(await hasher.verify(typeof password === 'string' ? password : '', found.passwordHash))
    ) {
      throw UnauthorizedError('Correo o contraseña incorrectos')
    }

    const publicUser = toPublicUser(found)
    return { user: publicUser, token: tokens.issue(publicUser) }
  }
