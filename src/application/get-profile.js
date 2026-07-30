import { NotFoundError } from '../domain/errors.js'
import { toPublicUser } from '../domain/user.js'

export const getProfile =
  ({ users }) =>
  async (id) => {
    const found = await users.findById(id)
    if (!found) throw NotFoundError('Usuario no encontrado')
    return { user: toPublicUser(found) }
  }
