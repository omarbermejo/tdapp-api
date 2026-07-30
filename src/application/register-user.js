import { ConflictError } from '../domain/errors.js'
import { createUser, toPublicUser } from '../domain/user.js'

export const registerUser =
  ({ users, hasher, tokens }) =>
  async (input) => {
    const { password, ...user } = createUser(input)

    if (await users.findByEmail(user.email)) {
      throw ConflictError('Ese correo ya tiene cuenta. Inicia sesion.')
    }

    const saved = await users.create({ ...user, passwordHash: await hasher.hash(password) })
    const publicUser = toPublicUser(saved)

    return { user: publicUser, token: tokens.issue(publicUser) }
  }
