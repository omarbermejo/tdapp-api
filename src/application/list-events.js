import { toPublicEvent } from '../domain/event.js'

/** Cuantas novedades caben en una pagina. Suficiente para llenar una pantalla alta sin pedir mas. */
const PAGE = 30
const MAX_PAGE = 100

/**
 * Las novedades de esta persona, de la mas nueva a la mas vieja.
 *
 * `before` es el cursor de paginacion (el id de la ultima fila pintada) y `since` es el hueco tras
 * reconectar. Son excluyentes: uno mira hacia atras y el otro hacia adelante.
 */
export const listEvents =
  ({ events }) =>
  async (userId, { before, since, limit } = {}) => {
    const size = Math.min(Number(limit) || PAGE, MAX_PAGE)

    const rows = since
      ? await events.listSince(userId, Number(since), size)
      : await events.list(userId, { before: before ? Number(before) : null, limit: size })

    return {
      events: rows.map(toPublicEvent),
      unread: await events.unreadCount(userId),
      // El cursor de la siguiente pagina, o null si ya no hay mas. Que lo calcule el servidor evita
      // que cada cliente reinvente "el id de la ultima".
      next: rows.length === size ? rows[rows.length - 1].id : null,
    }
  }
