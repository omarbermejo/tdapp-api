import { ValidationError } from './errors.js'
import { FOCUS_AREAS } from './user.js'

export const TASK_SIZE = ['quick', 'medium', 'deep']
export const TASK_STATUS = ['pending', 'done']

/** Minutos sugeridos por tamaño. La app los usa para el timer y la Live Activity. */
export const SIZE_MINUTES = { quick: 5, medium: 25, deep: 50 }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/
const str = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Valida una tarea completa. `base` permite reusar esto para PATCH: se mezcla lo
 * que ya existe con lo que llega y se valida el resultado, no el parche suelto.
 */
export function makeTask(input = {}, base = {}) {
  const merged = { ...base, ...input }
  const fields = {}

  const title = str(merged.title)
  if (!title) fields.title = 'La tarea necesita un titulo'
  else if (title.length > 120) fields.title = 'Maximo 120 caracteres; si no cabe, partela en dos'

  const notes = str(merged.notes)
  if (notes.length > 1000) fields.notes = 'Maximo 1000 caracteres'

  const pick = (key, catalog, fallback) => {
    const value = str(merged[key]) || fallback
    if (!catalog.includes(value)) fields[key] = `Opcion no valida: ${value}`
    return value
  }

  const focusArea = str(merged.focusArea) || null
  if (focusArea && !FOCUS_AREAS.includes(focusArea)) fields.focusArea = `Opcion no valida: ${focusArea}`

  const dueAt = merged.dueAt == null || merged.dueAt === '' ? null : str(merged.dueAt)
  if (dueAt && (!ISO_DATE.test(dueAt) || Number.isNaN(Date.parse(dueAt)))) {
    fields.dueAt = 'Usa una fecha ISO con zona, ej 2026-07-30T18:00:00-06:00'
  }

  const task = {
    title,
    notes: notes || null,
    size: pick('size', TASK_SIZE, 'medium'),
    status: pick('status', TASK_STATUS, 'pending'),
    focusArea,
    dueAt,
    // La fecha local viene dentro del ISO que manda el cliente: filtrar "hoy" es comparar
    // texto y no adivinar zonas horarias en el servidor.
    dueDate: dueAt ? dueAt.slice(0, 10) : null,
  }

  if (Object.keys(fields).length) throw ValidationError(fields)
  return task
}

export const toPublicTask = (row) => ({
  id: row.id,
  title: row.title,
  notes: row.notes,
  size: row.size,
  status: row.status,
  focusArea: row.focusArea,
  dueAt: row.dueAt,
  dueDate: row.dueDate,
  suggestedMinutes: SIZE_MINUTES[row.size],
  /** Segundos acumulados + los del tramo en curso, para que la app no tenga que sumar. */
  elapsedSeconds: row.elapsedSeconds + secondsSince(row.startedAt),
  startedAt: row.startedAt,
  running: !!row.startedAt,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
})

export const secondsSince = (isoOrNull) =>
  isoOrNull ? Math.max(0, Math.floor((Date.now() - Date.parse(isoOrNull)) / 1000)) : 0

export const taskCatalogs = {
  size: TASK_SIZE,
  status: TASK_STATUS,
  focusArea: FOCUS_AREAS,
  sizeMinutes: SIZE_MINUTES,
}
