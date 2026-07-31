import { toPublicTask } from '../domain/task.js'

export const listTasks =
  ({ tasks }) =>
  async (userId, query = {}) => {
    const found = await tasks.listByUser(userId, {
      status: query.status || null,
      date: query.date || null,
      focusArea: query.focusArea || null,
      // Una fecha, y trae lo que quedo atras de ella: vencido o sin agendar. Ver `listByUser`.
      backlog: query.backlog || null,
    })
    return { tasks: found.map(toPublicTask) }
  }
