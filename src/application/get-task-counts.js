import { TASK_STATUS } from '../domain/task.js'

/**
 * El resumen de la tarjeta "Mis tareas" del perfil: cuantas cerradas y cuantas pendientes, de
 * siempre.
 *
 * Va aparte de /me/stats por la misma razon que /streak va aparte de /today: son dos preguntas
 * distintas. `stats` responde "como fueron estas cuatro semanas" — filtra por ventana y por
 * due_date, asi que su `totals.done` ENCOGE con el tiempo y no cuenta lo que nunca se agendo. Esto
 * responde "cuanto llevas", que es un numero que solo sube y por eso puede vivir en un perfil.
 *
 * Tampoco es una columna contador en user_profiles: se deriva de las tareas, que son el hecho. Un
 * contador guardado seria un segundo estado capaz de contradecir a la tabla, que cada alta, cada
 * toggle, cada borrado y cada CASCADE tendria que mantener — y la primera deriva no la nota nadie
 * porque no habria nada que la contradijera. Es el mismo argumento de `stageOf`.
 *
 * Las llaves son las de /me/today.counts para que la app pinte las dos con el mismo componente.
 */
export const getTaskCounts =
  ({ tasks }) =>
  async (userId) => {
    const counts = Object.fromEntries(TASK_STATUS.map((status) => [status, 0]))
    let total = 0

    for (const row of await tasks.countByStatus(userId)) {
      // Un estado que el dominio todavia no conoce suma al total pero no inventa una llave: la app
      // pinta las que espera y el total sigue cuadrando con la tabla.
      if (row.status in counts) counts[row.status] = row.n
      total += row.n
    }

    return { counts: { total, ...counts } }
  }
