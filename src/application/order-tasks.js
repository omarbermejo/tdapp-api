import { ValidationError } from '../domain/errors.js'
import { toPublicTask } from '../domain/task.js'

/** Tope de seguridad: nadie arrastra a mano una lista mas larga que un dia muy cargado. */
const MAX_IDS = 200

/**
 * Escribe el orden manual de una lista de tareas: la posicion de cada id es su indice.
 *
 * Recibe la lista COMPLETA del dia y no un par (id, posicion nueva). Es lo que hace que el orden sea
 * consistente: si solo se moviera una, las demas se quedarian con posicion NULL y el ORDER BY las
 * mandaria al final todas juntas — o sea que mover una cosa reordenaria el dia entero sin pedirlo.
 *
 * La comprobacion de propiedad va ANTES de escribir y de una sola consulta: con un id ajeno en la
 * lista, el UPDATE no encontraria la fila (lleva `WHERE user_id = ?`) y fallaria en silencio dejando
 * el orden a medias. Mejor rechazar la peticion entera.
 */
export const orderTasks =
  ({ tasks }) =>
  async (userId, ids) => {
    if (!Array.isArray(ids) || !ids.length) {
      throw ValidationError({ ids: 'Manda la lista de tareas en el orden que quieres' })
    }
    if (ids.length > MAX_IDS) throw ValidationError({ ids: `Maximo ${MAX_IDS} tareas` })

    const clean = ids.map(Number)
    if (clean.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw ValidationError({ ids: 'Hay un identificador que no es valido' })
    }
    // Un id repetido dejaria dos tareas con la misma posicion y el desempate por id daria un orden
    // que la persona no eligio.
    if (new Set(clean).size !== clean.length) throw ValidationError({ ids: 'Hay identificadores repetidos' })

    const owned = await tasks.ownedIds(userId, clean)
    if (owned.size !== clean.length) {
      throw ValidationError({ ids: 'Alguna de esas tareas no existe' })
    }

    await tasks.setPositions(userId, clean)

    // Devuelve el dia releido y no un 204: la app acaba de pintar su orden optimista y esto le
    // confirma el que quedo guardado, sin obligarla a una segunda peticion.
    const saved = await Promise.all(clean.map((id) => tasks.findById(userId, id)))
    return { tasks: saved.map(toPublicTask) }
  }
