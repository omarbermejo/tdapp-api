import { NotFoundError } from '../domain/errors.js'
import { makeWorkspace, toPublicWorkspace } from '../domain/workspace.js'

/**
 * PATCH de verdad: se mezcla lo que llega sobre lo que hay y se valida el resultado, igual que
 * `updateTask`. Asi el mismo endpoint sirve para renombrar y para cambiarle el color.
 */
export const updateWorkspace =
  ({ workspaces }) =>
  async (userId, id, patch = {}) => {
    // `findOwned` y no `findById`: administrar es del dueño. Un miembro trabaja en el espacio, pero
    // no lo renombra ni lo recolorea — la clasificacion manda el icono y el color de TODAS sus tareas
    // para todo el mundo, y eso no puede cambiarlo quien acaba de entrar.
    const current = await workspaces.findOwned(userId, id)
    if (!current) throw NotFoundError('Ese espacio no existe')

    const saved = await workspaces.update(userId, id, makeWorkspace(patch, current))
    return { workspace: toPublicWorkspace(saved) }
  }
