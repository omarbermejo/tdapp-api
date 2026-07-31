import { SIZE_MINUTES } from './task.js'

/**
 * Lo que se cerro en una ventana de dias, resumido.
 *
 * Es dominio puro y no una consulta con mas SQL por la misma razon que la racha: que cuenta como
 * "un minuto de trabajo" es una decision de producto, y esas viven aqui, donde se leen y se prueban
 * sin base de datos.
 */

/**
 * Cuantos dias hacia atras mira Progreso por defecto: 28 contando hoy, o sea cuatro columnas de
 * siete. El numero sale de la rejilla, no al reves.
 */
export const STATS_WINDOW = 27

/** Tope duro de la ventana, igual que `STREAK_WINDOW`. Nadie necesita graficar mas de un año. */
export const STATS_MAX = 365

/**
 * Los minutos de un grupo de tareas cerradas.
 *
 * Son minutos PLANEADOS, no cronometrados, y la diferencia importa: `elapsed_seconds` solo crece
 * cuando corres el pomodoro CON una tarea enganchada, y la mayoria de las tareas se cierran de un
 * swipe. Una grafica alimentada de tiempo real saldria casi vacia para casi todo el mundo, y una
 * pantalla de progreso que se ve vacia cuando el dia estuvo lleno es peor que no tenerla.
 *
 * `minutes` nulo cae en lo que sugiere el tamaño; esa equivalencia la manda `domain/task.js` y no
 * se repite en SQL.
 */
const minutesOf = (row) => (row.minutes ?? SIZE_MINUTES[row.size] ?? 0) * row.done

/**
 * Pliega las filas de `doneStats` en las tres vistas que pinta Progreso.
 *
 * No devuelve promedio por dia a proposito. Dividir entre los dias del rango castiga los huecos, y
 * eso es justo lo que `domain/streak.js` se niega a hacer; dividir entre los dias con algo cerrado
 * no significa nada. Si la pantalla lo quiere, es una division de una linea alla — no un campo del
 * API que hornee un argumento de producto.
 */
export function foldStats(rows) {
  const byDay = new Map()
  const byArea = new Map()
  let done = 0
  let minutes = 0

  for (const row of rows) {
    const mins = minutesOf(row)
    done += row.done
    minutes += mins

    const day = byDay.get(row.date) ?? { date: row.date, done: 0, minutes: 0 }
    day.done += row.done
    day.minutes += mins
    byDay.set(row.date, day)

    // `null` es un area legitima: son las tareas que nadie clasifico, y en el desglose se ven como
    // "Sin area". Perderlas haria que las barras no sumaran el total.
    const area = byArea.get(row.focusArea) ?? { focusArea: row.focusArea, done: 0, minutes: 0 }
    area.done += row.done
    area.minutes += mins
    byArea.set(row.focusArea, area)
  }

  return {
    // Por dia va en orden cronologico: es una serie de tiempo y se dibuja de izquierda a derecha.
    byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    // Por area va de mas a menos: es un ranking y lo primero que se lee es en que se fue el tiempo.
    byArea: [...byArea.values()].sort((a, b) => b.minutes - a.minutes),
    totals: { done, minutes },
  }
}
