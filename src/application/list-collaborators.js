import { toPublicMember } from '../domain/user.js'

/**
 * Las personas con las que ya has trabajado, para no tener que teclear un correo cada vez.
 *
 * De cada una sale UN espacio: aquel en el que mas tareas han compartido. Es lo que se pidio, y es lo
 * que la convierte en una recomendacion util — "Ana, de La tesis" dice mas que "Ana, de cuatro
 * espacios".
 *
 * El mapeo pasa OBLIGATORIAMENTE por `toPublicMember`: la consulta trae el perfil por JOIN, y esa
 * funcion es lo que impide que un dia se cuele un correo en una tira de sugerencias.
 */
export const listCollaborators =
  ({ members }) =>
  async (userId) => ({
    collaborators: (await members.collaboratorsOf(userId)).map((row) => ({
      person: toPublicMember(row),
      workspace: {
        id: row.workspaceId,
        name: row.workspaceName,
        icon: row.workspaceIcon,
        accent: row.workspaceAccent,
      },
      tasks: row.tasks,
    })),
  })
