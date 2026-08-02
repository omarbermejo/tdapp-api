/**
 * Las novedades de una tarea: que clase de cosa paso y a quien le importa.
 *
 * Puro, sin I/O. Quien escribe las filas es `application/record-event.js`.
 */

/**
 * Las seis cosas que le pueden pasar a una tarea y que merecen contarse.
 *
 * Catalogo cerrado y validado aqui, no con un CHECK en SQL — mismo trato que `TASK_SIZE` y
 * `TASK_STATUS`, que tampoco lo llevan.
 */
export const EVENT_KINDS = ['created', 'completed', 'reopened', 'moved', 'edited', 'deleted']

/** Los campos cuyo cambio cuenta como "editada". El resto se mueve solo y no es noticia. */
const WATCHED = ['title', 'notes', 'size', 'minutes', 'focusArea', 'icon', 'dueAt']

/**
 * Que evento describe el paso de `current` a `next`, o null si no cambio nada que contar.
 *
 * UN SOLO evento por peticion, con esta precedencia. Un PATCH que cierra la tarea y la mueve a la
 * vez fue UN gesto, y dos filas por un toque se leen como ruido en una lista que se mira de reojo.
 * Lo que gana es lo mas especifico: cerrar dice mas que editar.
 */
export function eventOfUpdate(current, next) {
  if (current.status !== 'done' && next.status === 'done') return { kind: 'completed', meta: null }
  if (current.status === 'done' && next.status !== 'done') return { kind: 'reopened', meta: null }

  if (current.workspaceId !== next.workspaceId) {
    // Ids pelados y no nombres: la app ya tiene la lista de espacios, y resolver el nombre aqui
    // costaria una consulta mas del espacio de origen en cada movimiento. null = personal.
    return { kind: 'moved', meta: { from: current.workspaceId ?? null, to: next.workspaceId ?? null } }
  }

  const changed = WATCHED.filter((key) => (current[key] ?? null) !== (next[key] ?? null))
  return changed.length ? { kind: 'edited', meta: { changed } } : null
}

/**
 * A quien le llega un evento de esta tarea.
 *
 * Hoy: solo a quien la creo. `tasks.user_id` ES el creador y es inmutable — el INSERT lo liga una
 * vez y ningun UPDATE lo vuelve a tocar, asi que no hace falta columna nueva para saberlo.
 *
 * ponytail: el dia que un espacio compartido tenga que avisar a sus miembros, esta funcion recibe la
 * lista y devuelve `[task.userId, ...miembros]`. `record-event` ya itera sobre el array y la
 * consulta del feed ya filtra por `user_id`, asi que el reparto es una fila por destinatario y nada
 * mas cambia. No se construye todavia porque sin salir de un espacio ni expulsar a nadie, la lista
 * de destinatarios aun no es un conjunto estable.
 */
export const recipientsOf = (task) => [task.userId]

/**
 * Un evento listo para la app.
 *
 * `read` en vez de la fecha cruda: a la pantalla le importa el booleano, y la hora de lectura no se
 * pinta en ningun sitio. `actor` sale del LEFT JOIN y puede venir en null si esa cuenta se borro —
 * el hecho de que la tarea se cerro sigue siendo cierto aunque ya no se sepa de quien fue.
 */
export const toPublicEvent = (row) => ({
  id: row.id,
  kind: row.kind,
  taskId: row.taskId ?? null,
  taskTitle: row.taskTitle,
  workspaceId: row.workspaceId ?? null,
  meta: row.meta ? JSON.parse(row.meta) : null,
  actor: row.actorId ? { id: row.actorId, name: row.actorName ?? null } : null,
  createdAt: row.createdAt,
  read: !!row.readAt,
})
