import { ForbiddenError, NotFoundError } from '../domain/errors.js'
import { toPublicMember } from '../domain/user.js'

/**
 * Las solicitudes que esperan MI respuesta, de todos los espacios que administro.
 *
 * Sin argumento de espacio a proposito: quien pregunta es la pantalla de novedades, y ahi la pregunta
 * es "¿alguien quiere entrar a algo mio?", no "¿alguien quiere entrar a este espacio?". El nombre del
 * espacio viaja en cada fila para que la lista se pueda leer sin cruzarla con nada.
 */
export const listRequests =
  ({ requests }) =>
  async (userId) => {
    const rows = await requests.listForOwner(userId)
    return {
      requests: rows.map((row) => ({
        person: toPublicMember(row),
        workspace: { id: row.workspaceId, name: row.workspaceName },
        askedAt: row.askedAt,
      })),
    }
  }

/**
 * Aprobar o rechazar que alguien entre.
 *
 * Las dos caben en un caso de uso porque comparten TODO menos la ultima linea: el mismo permiso, la
 * misma busqueda y el mismo borrado de la solicitud. Separarlas dejaria dos copias de la escalera de
 * guards, que es justo donde se cuela un agujero cuando alguien toca una y no la otra.
 *
 * **El codigo se consume al APROBAR**, no al solicitar. Rechazar lo deja vivo, y eso es lo correcto:
 * un codigo abierto puede tener a varias personas detras, y decirle que no a una no puede invalidarlo
 * para las demas. Que caduque a los siete dias sigue siendo su unico limite.
 */
export const decideRequest =
  ({ requests, workspaces, members, invites }) =>
  async (userId, workspaceId, personId, approve) => {
    /**
     * `findById` y no `findAny`: solo el DUEÑO decide. Un miembro ve el espacio y trabaja en el, pero
     * dejar entrar a alguien mas es de quien lo administra — si no, cualquiera con acceso podria
     * ampliar la lista sin que el dueño se entere.
     */
    const workspace = await workspaces.findById(userId, workspaceId)
    if (!workspace) throw ForbiddenError('Ese espacio no es tuyo')

    const request = await requests.find(workspaceId, personId)
    if (!request) throw NotFoundError('Esa solicitud ya no está')

    await requests.remove(workspaceId, personId)

    if (!approve) return { approved: false }

    await members.add(workspaceId, personId, 'member')
    await invites.remove(request.code)
    return { approved: true }
  }
