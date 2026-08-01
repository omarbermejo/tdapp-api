import { ValidationError } from '../domain/errors.js'
import { makeTask, toPublicTask } from '../domain/task.js'

export const createTask =
  ({ tasks, workspaces }) =>
  async (userId, input) => {
    const task = makeTask(input)

    /**
     * Que el espacio sea uno en el que puedes trabajar.
     *
     * `makeTask` solo comprueba que el id sea un entero positivo, y la clave ajena solo exige que el
     * espacio EXISTA — no que sea tuyo. Hasta ahora el agujero no era alcanzable porque las listas
     * filtraban por `user_id` de todas formas; desde que la app manda un `workspaceId` que sale de un
     * espacio activo, esta es la puerta.
     *
     * El mensaje es el mismo que da un espacio inexistente, a proposito: dos textos distintos
     * convertirian el endpoint en un detector de ids validos.
     */
    if (task.workspaceId && !(await workspaces.findById(userId, task.workspaceId))) {
      throw ValidationError({ workspaceId: 'Ese espacio no existe' })
    }

    const saved = await tasks.create(userId, task)
    return { task: toPublicTask(saved) }
  }
