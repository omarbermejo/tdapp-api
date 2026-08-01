import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js'
import { secondsSince, toPublicTask } from '../domain/task.js'

/**
 * Arranca o para TU cronometro en una tarea. Solo puede haber uno corriendo por persona:
 * dos timers a la vez es justo lo que un cerebro con TDAH no necesita.
 *
 * "Por persona" y no "por tarea": en un espacio compartido, que Ana cronometre algo no puede ocupar la
 * ranura de Omar ni sumarse a su contador. El reloj vive en `task_timers`, una fila por pareja
 * (tarea, persona), y `task.startedAt`/`elapsedSeconds` ya llegan resueltos para quien pregunta.
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
