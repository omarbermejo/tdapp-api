import { makeTask, toPublicTask } from '../domain/task.js'

export const createTask =
  ({ tasks }) =>
  async (userId, input) => {
    const saved = await tasks.create(userId, makeTask(input))
    return { task: toPublicTask(saved) }
  }
