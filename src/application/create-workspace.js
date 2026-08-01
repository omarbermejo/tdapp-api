import { makeWorkspace, toPublicWorkspace } from '../domain/workspace.js'

/**
 * Crear un espacio. Nace AL FINAL de la lista salvo que se pida una posicion.
 *
 * La posicion se resuelve aqui y no en el dominio porque depende de lo que ya hay guardado, que es
 * justo lo que el dominio no puede saber sin I/O.
 */
export const createWorkspace =
  ({ workspaces }) =>
  async (userId, input = {}) => {
    const position = input.position ?? (await workspaces.nextPosition(userId))
    const saved = await workspaces.create(userId, makeWorkspace({ ...input, position }))
    return { workspace: toPublicWorkspace(saved) }
  }
