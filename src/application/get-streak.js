import {
  STREAK_WINDOW,
  bestStreak,
  currentStreak,
  shiftDay,
  weekOf,
} from '../domain/streak.js'

/**
 * La racha del usuario y su semana, para el widget.
 *
 * Una llamada y tres datos: cuantos dias seguidos llevas, tu mejor marca, y el punteo de esta semana.
 * El widget no puede encadenar peticiones ni contar nada, asi que todo llega mascado — es la misma
 * decision que `getToday`.
 *
 * El dia lo manda el cliente porque quien sabe en que dia vive el usuario es su telefono: calcularlo
 * en UTC aqui rompaeria la racha de cualquiera al oeste de Greenwich cada noche.
 */
export const getStreak =
  ({ tasks }) =>
  async (userId, date) => {
    const today = date || new Date().toISOString().slice(0, 10)
    const days = await tasks.doneByDay(userId, {
      from: shiftDay(today, -STREAK_WINDOW),
      to: today,
    })

    return {
      date: today,
      days: currentStreak(days, today),
      best: bestStreak(days),
      week: weekOf(days, today),
    }
  }
