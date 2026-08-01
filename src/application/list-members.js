import { NotFoundError } from '../domain/errors.js'
import { toPublicMember } from '../domain/user.js'

/**
 * Quien esta en un espacio. Lo pueden ver los MIEMBROS, no solo el dueño: trabajar con gente sin saber
 * con quien trabajas no tiene sentido.
 *
 * Cada fila pasa por `toPublicMember`, que es el filtro: la consulta trae el perfil por JOIN y sin el
 * saldrian datos que un compañero no tiene por que ver.
 */
export const listMembers =
  ({ workspaces, members }) =>
  async (userId, workspaceId) => {
    if (!(await workspaces.findById(userId, workspaceId))) throw NotFoundError('Ese espacio no existe')
    return {
      members: (await members.listOf(workspaceId)).map((row) => ({
        ...toPublicMember(row),
        role: row.role,
      })),
    }
  }
