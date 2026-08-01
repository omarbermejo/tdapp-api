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
  async (userId, { date, from } = {}) => {
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
    const done = await tasks.doneStats(userId, { from: start, to })
    const planned = await tasks.plannedByDay(userId, { from: start, to })

    return { from: start, to, ...foldStats(done, planned) }
  }
