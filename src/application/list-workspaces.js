import { toPublicWorkspace } from '../domain/workspace.js'

/**
 * Los espacios con su progreso. El conteo lo hace el repositorio en SQL, asi que esto es un mapeo.
 */
export const listWorkspaces =
  ({ workspaces }) =>
  async (userId) => {
    const rows = await workspaces.listWithCounts(userId)
    return { workspaces: rows.map(toPublicWorkspace) }
  }
