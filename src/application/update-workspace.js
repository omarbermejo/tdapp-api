import { NotFoundError } from '../domain/errors.js'
import { makeWorkspace, toPublicWorkspace } from '../domain/workspace.js'

/**
 * PATCH de verdad: se mezcla lo que llega sobre lo que hay y se valida el resultado, igual que
 * `updateTask`. Asi el mismo endpoint sirve para renombrar y para cambiarle el color.
 */
export const updateWorkspace =
  ({ workspaces }) =>
  async (userId, id, patch = {}) => {
    const current = await workspaces.findById(userId, id)
    if (!current) throw NotFoundError('Ese espacio no existe')

    const saved = await workspaces.update(userId, id, makeWorkspace(patch, current))
    return { workspace: toPublicWorkspace(saved) }
  }
