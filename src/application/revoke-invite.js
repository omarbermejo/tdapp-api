import { NotFoundError } from '../domain/errors.js'
import { normalizeInviteCode } from '../domain/invite.js'

/**
 * Anula una invitacion antes de que la usen.
 *
 * `removeIn` con los DOS parametros y no `remove(code)` pelado: si no, el dueño del espacio A podria
 * borrar la invitacion del espacio B con solo conocer su codigo — y los codigos se comparten, asi que
 * conocerlos es lo normal.
 */
export const revokeInvite =
  ({ workspaces, invites }) =>
  async (userId, workspaceId, code) => {
    if (!(await workspaces.findOwned(userId, workspaceId))) throw NotFoundError('Ese espacio no existe')
    if (!(await invites.removeIn(workspaceId, normalizeInviteCode(code)))) {
      throw NotFoundError('Esa invitación ya no existe')
    }
  }
