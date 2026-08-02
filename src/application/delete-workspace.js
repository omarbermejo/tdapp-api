import { NotFoundError } from '../domain/errors.js'

/**
 * Borrar un espacio NO borra sus tareas: la FK las deja con `workspace_id = NULL` y siguen saliendo
 * en el dia al que pertenecen. Perder trabajo por reorganizar carpetas seria el peor modo de falla
 * posible en una app de tareas.
 */
export const deleteWorkspace =
  ({ workspaces }) =>
  async (userId, id) => {
    if (!(await workspaces.remove(userId, id))) throw NotFoundError('Ese espacio no existe')
  }
