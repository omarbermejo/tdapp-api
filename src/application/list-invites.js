import { NotFoundError } from '../domain/errors.js'
import { toPublicInvite } from '../domain/invite.js'

/** Las invitaciones vivas de un espacio. Del dueño: son la lista de a quien dejo entrar. */
export const listInvites =
  ({ workspaces, invites }) =>
  async (userId, workspaceId) => {
    if (!(await workspaces.findOwned(userId, workspaceId))) throw NotFoundError('Ese espacio no existe')
    return { invites: (await invites.listOf(workspaceId)).map(toPublicInvite) }
  }
