import { NotFoundError } from '../domain/errors.js'
import { toPublicWorkspace } from '../domain/workspace.js'

/**
 * Un espacio con su progreso. Es la cabecera de su pantalla de detalle.
 *
 * Aparte de `listWorkspaces` y no un filtro suyo: la pantalla de detalle se puede abrir desde un enlace
 * y necesita saber si ese espacio existe (404) en vez de recibir una lista vacia.
 */
export const getWorkspace =
  ({ workspaces }) =>
  async (userId, id) => {
    const row = await workspaces.findByIdWithCounts(userId, id)
    if (!row) throw NotFoundError('Ese espacio no existe')
    return { workspace: toPublicWorkspace(row) }
  }
