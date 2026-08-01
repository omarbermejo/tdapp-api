import { toPublicTask } from '../domain/task.js'

export const listTasks =
  ({ tasks }) =>
  async (userId, query = {}) => {
    const found = await tasks.listByUser(userId, {
      status: query.status || null,
      date: query.date || null,
      focusArea: query.focusArea || null,
      // Todas las de un espacio, sin filtro de dia: es lo que pinta su pantalla de detalle.
      // `Number(...) || null` cubre de una vez el ausente, el vacio y la basura no numerica.
      workspaceId: Number(query.workspaceId) || null,
      // Una fecha, y trae lo que quedo atras de ella: vencido o sin agendar. Ver `listByUser`.
      backlog: query.backlog || null,
    })
    return { tasks: found.map(toPublicTask) }
  }
