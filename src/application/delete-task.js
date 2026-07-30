import { NotFoundError } from '../domain/errors.js'

export const deleteTask =
  ({ tasks }) =>
  async (userId, id) => {
    if (!(await tasks.remove(userId, id))) throw NotFoundError('Esa tarea no existe')
  }
