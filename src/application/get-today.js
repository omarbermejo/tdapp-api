import { NotFoundError } from '../domain/errors.js'
import { toPublicTask } from '../domain/task.js'
import { toPublicUser } from '../domain/user.js'

/**
 * La siguiente de la lista: la pendiente con la hora mas cercana, y si ninguna tiene hora, la
 * primera tal como venga.
 *
 * Ordena una copia (`toSorted` no muta) y solo entre las que TIENEN hora: mezclar las sin hora en el
 * sort las mandaria al principio o al final segun el comparador, cuando lo que se quiere es que solo
 * cuenten si no hay ninguna con hora.
 */
const nextUp = (pending) => {
  const timed = pending.filter((t) => t.dueAt).toSorted((a, b) => (a.dueAt < b.dueAt ? -1 : 1))
  return timed[0] ?? pending[0] ?? null
}

/**
 * Todo lo que el widget y la Live Activity necesitan en una sola llamada:
 * qué corre ahora, qué sigue y cómo va el día. Una peticion, no cinco.
 */
export const getToday =
  ({ users, tasks }) =>
  async (userId, date) => {
    const row = await users.findById(userId)
    if (!row) throw NotFoundError('Usuario no encontrado')
    // Por toPublicUser para que el perfil llegue con defaults resueltos, no con nulls del JOIN.
    const user = toPublicUser(row)

    const today = date || new Date().toISOString().slice(0, 10)
    const [ofDay, running] = await Promise.all([
      tasks.listByUser(userId, { date: today, status: null, focusArea: null }),
      tasks.findRunning(userId),
    ])

    const list = ofDay.map(toPublicTask)
    const pending = list.filter((t) => t.status === 'pending')

    return {
      date: today,
      user: { name: user.name, accentColor: user.accentColor, reminderStyle: user.reminderStyle },
      counts: { total: list.length, pending: pending.length, done: list.length - pending.length },
      /**
       * La proxima es la pendiente con la hora mas cercana; si ninguna tiene hora, la primera.
       *
       * Se ORDENA en vez de tomar la primera con hora, y eso no es de adorno: desde que existe el
       * orden manual (`position` manda sobre `due_at` en `listByUser`), la primera de la lista puede
       * ser la de las 7pm con una de las 9am todavia pendiente. `pending.find(t => t.dueAt)` decia
       * "la mas cercana" y devolvia "la primera que el usuario coloco", que dejo de ser lo mismo.
       */
      next: nextUp(pending),
      running: running ? toPublicTask(running) : null,
      tasks: list,
    }
  }
