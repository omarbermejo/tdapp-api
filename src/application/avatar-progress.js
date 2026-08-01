import { STREAK_WINDOW, bestStreak, shiftDay } from '../domain/streak.js'

/**
 * Cuanto lleva la persona en los dos ejes que miden los logros.
 *
 * Vive aparte porque lo necesitan LEER el vestidor y RECLAMAR una cara, y con la regla duplicada un
 * logro podria verse abierto en la lista y rechazarse al reclamarlo — el peor fallo posible en algo
 * que se gana.
 *
 * Los dos numeros se derivan de `tasks` en cada llamada y ninguno se guarda: `done` es el historico
 * completo (no una ventana, o un logro se podria PERDER dejando pasar el tiempo) y `best` es la
 * mejor racha del ultimo año, la misma que ya calcula `/me/streak`.
 *
 * El dia lo manda el cliente por lo mismo que en la racha: quien sabe en que dia vive el usuario es
 * su telefono, y calcularlo en UTC aqui movería la racha de cualquiera al oeste de Greenwich.
 */
export const avatarProgress = async ({ tasks }, userId, date) => {
  const today = date || new Date().toISOString().slice(0, 10)

  const [counts, days] = await Promise.all([
    tasks.countByStatus(userId),
    tasks.doneByDay(userId, { from: shiftDay(today, -STREAK_WINDOW), to: today }),
  ])

  // 'done' literal, el mismo valor que filtra el SQL de doneByDay. Sin fila para ese estado, cero.
  const done = counts.find((row) => row.status === 'done')?.n ?? 0
  return { done, best: bestStreak(days) }
}
