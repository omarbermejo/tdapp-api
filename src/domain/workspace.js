import { ValidationError } from './errors.js'
import { ACCENT_COLOR } from './user.js'

/**
 * Un espacio de trabajo: un nombre, un icono y un color para agrupar tareas por proyecto.
 *
 * Dominio puro, misma forma que `domain/task.js`: valida y lanza, o devuelve el objeto limpio.
 */

/**
 * Los iconos que puede llevar un espacio: los slugs 3D que la app tiene horneados en
 * `assets/icons3d/`.
 *
 * El catalogo vive aqui y sale por `GET /workspaces/catalogs` para que el cliente no lo escriba dos
 * veces. Si algun dia se hornea uno nuevo, se añade aqui y la app lo ve sin desplegarse — que es lo
 * contrario de lo que pasaria con la lista cableada en el bundle.
 *
 * `home-chrome` NO esta: es la variante en cromo del icono de Hoy para la barra de pestañas, no un
 * objeto que alguien elegiria para un proyecto.
 */
export const WORKSPACE_ICONS = [
  'academic',
  'calendar',
  'check',
  'clock',
  'creativity',
  'graph-up',
  'health',
  'home',
  'leaf',
  'light',
  'lightning',
  'money',
  'moon',
  'relationships',
  'trophy',
  'user',
  'work',
]

/** Cabe en una card de media fila sin partirse en tres lineas. */
const MAX_NAME = 40

const str = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Valida un espacio completo. `base` permite reusar esto para PATCH: se mezcla lo que ya existe con
 * lo que llega y se valida el RESULTADO, no el parche suelto. Es el mismo contrato de `makeTask`.
 */
export function makeWorkspace(input = {}, base = {}) {
  const merged = { ...base, ...input }
  const fields = {}

  const name = str(merged.name)
  if (!name) fields.name = 'El espacio necesita un nombre'
  else if (name.length > MAX_NAME) fields.name = `Maximo ${MAX_NAME} caracteres`

  // Sin default silencioso: un espacio sin icono ni color no se distinguiria del de al lado, y la
  // app siempre los manda porque su pantalla de crear los pide los dos.
  const icon = str(merged.icon) || 'work'
  if (!WORKSPACE_ICONS.includes(icon)) fields.icon = `Opcion no valida: ${icon}`

  const accent = str(merged.accent) || 'olive'
  if (!ACCENT_COLOR.includes(accent)) fields.accent = `Opcion no valida: ${accent}`

  const position = merged.position == null || merged.position === '' ? 0 : Number(merged.position)
  if (!(Number.isInteger(position) && position >= 0)) fields.position = 'Posicion no valida'

  if (Object.keys(fields).length) throw ValidationError(fields)
  return { name, icon, accent, position }
}

/**
 * Lo que ve el cliente. `total` y `done` los cuenta el repositorio con un LEFT JOIN, asi que la
 * pantalla pinta el anillo de progreso con UNA sola llamada y sin traerse las tareas.
 *
 * Caen en 0 cuando la fila viene de un create o un update, que no cuentan nada: un espacio recien
 * creado no tiene tareas, asi que 0 de 0 es la verdad y no un hueco.
 */
export const toPublicWorkspace = (row) => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  accent: row.accent,
  position: row.position,
  total: row.total ?? 0,
  done: row.done ?? 0,
  createdAt: row.createdAt,
})

export const workspaceCatalogs = {
  icon: WORKSPACE_ICONS,
  accent: ACCENT_COLOR,
  name: { max: MAX_NAME },
}
