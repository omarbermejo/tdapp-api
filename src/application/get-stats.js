import { ValidationError } from '../domain/errors.js'
import { STATS_MAX, STATS_WINDOW, foldStats } from '../domain/stats.js'
import { daysBetween, shiftDay } from '../domain/streak.js'

/**
 * Lo que la pantalla de Progreso necesita en una sola llamada: la serie por dia, el desglose por
 * area y los totales.
 *
 * El dia lo manda el cliente por lo mismo que en la racha: quien sabe en que dia vive el usuario es
 * su telefono, y resolverlo en UTC aqui corre la ventana una noche entera para medio mundo.
 */
export const getStats =
  ({ tasks }) =>
  async (userId, { date, from, workspaceId } = {}) => {
    const to = date || new Date().toISOString().slice(0, 10)
    const start = from || shiftDay(to, -STATS_WINDOW)

    const span = daysBetween(start, to)
    if (span < 0) throw ValidationError({ from: 'El inicio no puede ser posterior al final' })
    if (span > STATS_MAX) throw ValidationError({ from: `Maximo ${STATS_MAX} dias` })

    /**
     * Dos consultas, dos `await` secuenciales y no un `Promise.all`.
     *
     * `node:sqlite` es SINCRONO: `DatabaseSync.prepare().all()` bloquea y devuelve filas, no una
     * promesa. Un `Promise.all` aqui no solaparia nada —la primera termina antes de que exista la
     * segunda— y solo pondria una forma que promete concurrencia donde no la hay.
     */
    /**
     * `workspaceId` acota las dos consultas al espacio, y es lo que deja que la MISMA pantalla de
     * estadisticas sirva para toda la cuenta y para un espacio suelto. `Number(...) || null` cubre de
     * una vez el ausente, el vacio y la basura no numerica.
     *
     * **Con espacio se cuenta el espacio ENTERO, no tu parte de el**: el trabajo de todos sus
     * miembros. Es la unica lectura que no miente cuando el espacio se comparte — el anillo de su card
     * y la lista de tareas ya cuentan a todos, y un mapa de calor que solo contara lo tuyo daria un
     * numero distinto sobre los mismos datos. Sin espacio no cambia nada: sigue siendo `user_id = ?`.
     *
     * No se comprueba que el espacio exista: si no es tuyo o no existe, el filtro no encuentra nada y
     * la respuesta sale en ceros. Es lo correcto — un 404 aqui diria si un id ajeno existe o no.
     */
    const space = Number(workspaceId) || null

    const done = await tasks.doneStats(userId, { from: start, to, workspaceId: space })
    const planned = await tasks.plannedByDay(userId, { from: start, to, workspaceId: space })

    return { from: start, to, ...foldStats(done, planned) }
  }
