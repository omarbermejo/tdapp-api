import { toPublicTask } from '../domain/task.js'

export const listTasks =
  ({ tasks }) =>
  async (userId, query = {}) => {
    const found = await tasks.listByUser(userId, {
      status: query.status || null,
      date: query.date || null,
      focusArea: query.focusArea || null,
    })
    return { tasks: found.map(toPublicTask) }
  }
