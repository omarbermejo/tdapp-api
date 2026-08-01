import { NotFoundError, ValidationError } from '../domain/errors.js'
import { makeTask, secondsSince, toPublicTask } from '../domain/task.js'

export const updateTask =
  ({ tasks, workspaces }) =>
  async (userId, id, patch = {}) => {
    const current = await tasks.findById(userId, id)
    if (!current) throw NotFoundError('Esa tarea no existe')

    const next = makeTask(patch, current)

    /**
     * MOVER una tarea a un espacio ajeno es la misma puerta que crearla ahi, asi que lleva el mismo
     * guard. Solo cuando CAMBIA: revalidar en cada PATCH seria una consulta de mas en el gesto mas
     * repetido de la app (marcar hecha), y el espacio en el que ya estaba ya se valido al ponerlo.
     */
    if (next.workspaceId && next.workspaceId !== current.workspaceId) {
      if (!(await workspaces.findById(userId, next.workspaceId))) {
        throw ValidationError({ workspaceId: 'Ese espacio no existe' })
      }
    }
    // Completar sella la hora; reabrir la borra, para que las rachas no cuenten de mas.
    const completedAt =
      next.status === 'done'
        ? (current.completedAt ?? new Date().toISOString())
        : null

    /**
     * Y con la hora, QUIEN la cerro. Se sella en el mismo movimiento por la misma razon: son el mismo
     * hecho, y separarlos dejaria una tarea cerrada sin dueño del merito.
     *
     * `?? userId` y no `userId` a secas: reabrir y volver a cerrar no le quita el merito a quien la
     * cerro la primera vez, igual que `completedAt` conserva la hora original. Y en un espacio
     * compartido `userId` puede no ser el dueño de la tarea — ese es justo el punto.
     */
    const completedBy = next.status === 'done' ? (current.completedBy ?? userId) : null

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

    const saved = await tasks.update(userId, id, { ...next, completedAt, completedBy })
    return { task: toPublicTask(saved) }
  }
