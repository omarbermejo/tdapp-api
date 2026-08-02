import { ValidationError } from './errors.js'
import { ACCENT_COLOR, FOCUS_AREAS, isAccent } from './user.js'

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

/**
 * De que es un espacio. Diez clasificaciones.
 *
 * **Los siete primeros son exactamente `FOCUS_AREAS`**, y eso no es pereza: es lo que hace el cambio
 * seguro. `makeTask` valida el foco sobre el MERGE y sin gate, asi que ESTRECHAR el catalogo dejaria
 * cada tarea historica con un valor retirado imposible de editar y de cerrar (400). Ensanchar no puede
 * romper nada. Los mapas de icono y de color del cliente crecen tres entradas en vez de reescribirse.
 *
 * Diez y no doce: caben en cinco filas de dos en la pantalla de alta sin scroll, y una lista mas larga
 * convierte "de que es esto" en una decision, que es justo lo que un cerebro con TDAH no necesita en el
 * segundo paso de crear algo.
 *
 * `fitness`, `event` y `business` son los tres nuevos. Cubren lo que la gente crea y los siete focos no
 * nombraban: entrenar para algo, organizar algo con fecha, y llevar algo que da dinero — que no es lo
 * mismo que `money`, que son las cuentas de casa.
 */
export const WORKSPACE_TAGS = [
  ...FOCUS_AREAS, // study, work, home, health, money, relationships, creativity
  'fitness',
  'event',
  'business',
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

  // `isAccent` y no `includes`: el acento de un espacio admite el mismo color propio que el de una
  // persona, y las dos validaciones tienen que moverse juntas o el alta rechaza lo que el perfil acepta.
  const accent = str(merged.accent) || 'olive'
  if (!isAccent(accent)) fields.accent = `Opcion no valida: ${accent}`

  const position = merged.position == null || merged.position === '' ? 0 : Number(merged.position)
  if (!(Number.isInteger(position) && position >= 0)) fields.position = 'Posicion no valida'

  /**
   * La clasificacion cae en `null` y NO en un default, al reves que el icono y el acento.
   *
   * Los dos de arriba tienen que existir siempre porque son como se distingue una card de la de al
   * lado. Esta no: un espacio sin clasificar es un estado legitimo — el de todos los que ya existian
   * antes de que la columna existiera, y el del espacio que alguien crea sin pensarlo. Y como
   * `makeWorkspace` valida el MERGE, ponerle un default aqui reescribiria en silencio la clasificacion
   * de cualquier espacio que se editara por otra cosa.
   */
  const tag = str(merged.tag) || null
  if (tag && !WORKSPACE_TAGS.includes(tag)) fields.tag = `Opcion no valida: ${tag}`

  if (Object.keys(fields).length) throw ValidationError(fields)
  return { name, icon, accent, position, tag }
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
  /** De que es. `null` = sin clasificar, que es un estado y no un hueco. */
  tag: row.tag ?? null,
  total: row.total ?? 0,
  done: row.done ?? 0,
  /**
   * Si lo ADMINISTRAS: renombrar, recolorear, invitar, borrar. `false` = te invitaron.
   *
   * Sale del API y no se deduce en el cliente porque el cliente no tiene con que: la lista trae tanto
   * los tuyos como aquellos en los que solo eres miembro, y la unica otra fuente de rol es pedir los
   * miembros de cada espacio — una peticion por fila para pintar una lista.
   *
   * SQLite no tiene booleanos: `w.user_id = ?` devuelve 1 o 0. El `!!` lo traduce aqui, una vez, en
   * vez de dejar que cada consumidor se acuerde. En las filas que vienen de un create o un update no
   * hay columna, y ahi `undefined` cae en `false` — es lo seguro: esconde una accion, no la ofrece.
   */
  isOwner: !!row.isOwner,
  createdAt: row.createdAt,
})

export const workspaceCatalogs = {
  icon: WORKSPACE_ICONS,
  accent: ACCENT_COLOR,
  tag: WORKSPACE_TAGS,
  name: { max: MAX_NAME },
}
