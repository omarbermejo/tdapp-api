import { NotFoundError } from '../domain/errors.js'

export const deleteTask =
  ({ tasks, recordEvent }) =>
  async (userId, id) => {
    /**
     * Se lee ANTES de borrar, y no es por comprobar que existe — `remove` ya devuelve si borro algo.
     * Es porque el evento necesita el titulo y el espacio, y despues del DELETE ya no hay de donde
     * sacarlos. Es justo el caso que obliga a que `task_events` guarde su propia copia del titulo.
     */
    const task = await tasks.findById(userId, id)
    if (!(await tasks.remove(userId, id))) throw NotFoundError('Esa tarea no existe')

    if (task) await recordEvent(task, { actorId: userId, kind: 'deleted' })
  }
