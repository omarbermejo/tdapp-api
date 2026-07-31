/**
 * La racha: cuantos dias SEGUIDOS cerraste al menos una cosa.
 *
 * Es dominio puro y no una consulta con ventanas de SQL a proposito: la regla de que cuenta como
 * "seguido" es una decision de producto (¿cuenta hoy si todavia no has cerrado nada?) y esas viven
 * aqui, donde se pueden leer y probar sin base de datos.
 */

/** Un dia en 'YYYY-MM-DD' mas o menos n dias. Aritmetica de texto, sin zonas de por medio. */
export const shiftDay = (date, days) => {
  const [y, m, d] = date.split('-').map(Number)
  // Date en UTC a proposito: solo se usa para sumar dias y volver a texto, nunca para una hora.
  const at = new Date(Date.UTC(y, m - 1, d + days))
  return at.toISOString().slice(0, 10)
}

/** Cuantos dias hay entre dos fechas 'YYYY-MM-DD'. Positivo si `to` es posterior. */
export const daysBetween = (from, to) => {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** Cuantos dias hacia atras se miran para la racha y el mejor historico. */
export const STREAK_WINDOW = 365

/**
 * La racha actual a partir de los dias con algo cerrado.
 *
 * **El dia de hoy no cuenta hasta que cierres algo, pero tampoco la rompe.** Es la decision que
 * importa: una racha que se pone en cero a las 00:01 castiga por no haber hecho nada a medianoche, y
 * con TDAH eso es exactamente el mensaje que hace que la gente abandone la app. Asi que la racha se
 * mide desde el ultimo dia con algo cerrado — si ese dia es hoy o ayer, la racha sigue viva.
 *
 * `days` recibe las filas de `doneByDay` (mas reciente primero) y `today` el dia local del telefono.
 */
export function currentStreak(days, today) {
  if (!days.length) return 0

  const closed = new Set(days.map((row) => row.date))
  const newest = days[0].date

  // Mas de un dia de hueco desde el ultimo cierre: la racha ya se rompio.
  const gap = daysBetween(newest, today)
  if (gap > 1) return 0

  let count = 0
  let cursor = newest
  while (closed.has(cursor)) {
    count += 1
    cursor = shiftDay(cursor, -1)
  }
  return count
}

/** La racha mas larga del historial. Es el numero que da algo que superar. */
export function bestStreak(days) {
  if (!days.length) return 0

  // De mas viejo a mas nuevo para poder contar de corrido.
  const dates = days.map((row) => row.date).sort()
  let best = 1
  let run = 1
  for (let i = 1; i < dates.length; i++) {
    run = daysBetween(dates[i - 1], dates[i]) === 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

/**
 * Los siete dias de la semana que contiene `today`, de lunes a domingo.
 *
 * Lunes primero porque es como se lee la tira de la semana en la app (`week-strip`), y con `done` por
 * dia para que el widget pinte el punteo sin tener que contar nada.
 */
export function weekOf(days, today) {
  const closed = new Map(days.map((row) => [row.date, row.done]))
  // getUTCDay: 0 es domingo. Se corre para que el lunes sea el 0 de la semana.
  const weekday = (Date.parse(`${today}T00:00:00Z`) / 86_400_000 + 4) % 7
  const monday = shiftDay(today, -((weekday + 6) % 7))

  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDay(monday, i)
    return { date, done: closed.get(date) ?? 0 }
  })
}
