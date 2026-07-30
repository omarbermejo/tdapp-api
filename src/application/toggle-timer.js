import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js'
import { secondsSince, toPublicTask } from '../domain/task.js'

/**
 * Arranca o para el cronometro de una tarea. Solo puede haber uno corriendo por usuario:
 * dos timers a la vez es justo lo que un cerebro con TDAH no necesita.
 */
export const toggleTimer =
  ({ tasks }) =>
  async (userId, id, action) => {
    if (!['start', 'stop'].includes(action)) throw ValidationError({ action: 'Usa start o stop' })

    const task = await tasks.findById(userId, id)
    if (!task) throw NotFoundError('Esa tarea no existe')

    if (action === 'start') {
      if (task.startedAt) return { task: toPublicTask(task) }

      const running = await tasks.findRunning(userId)
      if (running) throw ConflictError(`Ya tienes "${running.title}" corriendo. Parala primero.`)

      const saved = await tasks.setTimer(userId, id, {
        startedAt: new Date().toISOString(),
        elapsedSeconds: task.elapsedSeconds,
      })
      return { task: toPublicTask(saved) }
    }

    const saved = await tasks.setTimer(userId, id, {
      startedAt: null,
      elapsedSeconds: task.elapsedSeconds + secondsSince(task.startedAt),
    })
    return { task: toPublicTask(saved) }
  }
