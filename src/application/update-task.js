import { NotFoundError } from '../domain/errors.js'
import { makeTask, toPublicTask } from '../domain/task.js'

export const updateTask =
  ({ tasks }) =>
  async (userId, id, patch = {}) => {
    const current = await tasks.findById(userId, id)
    if (!current) throw NotFoundError('Esa tarea no existe')

    const next = makeTask(patch, current)
    // Completar sella la hora; reabrir la borra, para que las rachas no cuenten de mas.
    const completedAt =
      next.status === 'done'
        ? (current.completedAt ?? new Date().toISOString())
        : null

    const saved = await tasks.update(userId, id, { ...next, completedAt })
    return { task: toPublicTask(saved) }
  }
