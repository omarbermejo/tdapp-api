import { NotFoundError } from '../domain/errors.js'
import { toPublicTask } from '../domain/task.js'
import { toPublicUser } from '../domain/user.js'

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
      // La proxima es la pendiente con hora mas cercana; si ninguna tiene hora, la primera.
      next: pending.find((t) => t.dueAt) ?? pending[0] ?? null,
      running: running ? toPublicTask(running) : null,
      tasks: list,
    }
  }
