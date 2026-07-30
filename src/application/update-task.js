import { NotFoundError } from '../domain/errors.js'
import { makeTask, secondsSince, toPublicTask } from '../domain/task.js'

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

    /**
     * Completar tambien para el cronometro, y se hace ANTES del patch: si el cronometro se
     * queda corriendo en una tarea hecha, `findRunning` la sigue devolviendo para siempre y
     * ningun otro timer puede arrancar (409 eterno). Va primero para que un fallo a mitad
     * deje la tarea parada y pendiente, nunca hecha y corriendo.
     */
    if (next.status === 'done' && current.startedAt) {
      await tasks.setTimer(userId, id, {
        startedAt: null,
        elapsedSeconds: current.elapsedSeconds + secondsSince(current.startedAt),
      })
    }

    const saved = await tasks.update(userId, id, { ...next, completedAt })
    return { task: toPublicTask(saved) }
  }
