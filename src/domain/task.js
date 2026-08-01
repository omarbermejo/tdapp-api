import { ValidationError } from './errors.js'
import { FOCUS_AREAS } from './user.js'

export const TASK_SIZE = ['quick', 'medium', 'deep']
export const TASK_STATUS = ['pending', 'done']

/** Minutos sugeridos por tamaño. La app los usa para el timer y la Live Activity. */
export const SIZE_MINUTES = { quick: 5, medium: 25, deep: 50 }

/** 1 min a 8 h. Debajo de 1 no es una tarea y arriba de 8 h no es una sesion, es un dia. */
const MIN_MINUTES = 1
const MAX_MINUTES = 480

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

  /**
   * null es un valor con significado: "no lo decidi, usa lo que sugiere el tamaño". Por eso
   * `minutes` no cae en un default — un default aqui borraria la diferencia entre elegir 25
   * y no haber elegido.
   */
  const minutes =
    merged.minutes == null || merged.minutes === '' ? null : Number(merged.minutes)
  if (
    minutes !== null &&
    !(Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES)
  ) {
    fields.minutes = `Entre ${MIN_MINUTES} y ${MAX_MINUTES} minutos`
  }

  const dueAt = merged.dueAt == null || merged.dueAt === '' ? null : str(merged.dueAt)
  if (dueAt && (!ISO_DATE.test(dueAt) || Number.isNaN(Date.parse(dueAt)))) {
    fields.dueAt = 'Usa una fecha ISO con zona, ej 2026-07-30T18:00:00-06:00'
  }

  /**
   * El espacio de trabajo, opcional. null lo saca del espacio sin borrar la tarea.
   *
   * Solo se valida la FORMA aqui: que el espacio exista y sea de esta persona lo garantiza la clave
   * ajena, y comprobarlo en el dominio obligaria a este modulo a hacer I/O. Un id de otra cuenta
   * revienta con un error de FK, que es un 500 feo pero no una fuga: la fila no se escribe.
   */
  const workspaceId =
    merged.workspaceId == null || merged.workspaceId === '' ? null : Number(merged.workspaceId)
  if (workspaceId !== null && !(Number.isInteger(workspaceId) && workspaceId > 0)) {
    fields.workspaceId = 'Espacio no valido'
  }

  const task = {
    title,
    notes: notes || null,
    size: pick('size', TASK_SIZE, 'medium'),
    minutes,
    status: pick('status', TASK_STATUS, 'pending'),
    focusArea,
    workspaceId,
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
  workspaceId: row.workspaceId ?? null,
  /** Orden manual dentro del dia. null = nunca se reordeno; lo escribe solo PATCH /tasks/order. */
  position: row.position ?? null,
  dueAt: row.dueAt,
  dueDate: row.dueDate,
  /** Lo que la persona puso; si no puso nada, lo que sugiere el tamaño. */
  minutes: row.minutes ?? null,
  suggestedMinutes: row.minutes ?? SIZE_MINUTES[row.size],
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
  minutes: { min: MIN_MINUTES, max: MAX_MINUTES },
  status: TASK_STATUS,
  focusArea: FOCUS_AREAS,
  sizeMinutes: SIZE_MINUTES,
}
