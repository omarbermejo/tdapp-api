/**
 * Marcar novedades como leidas. Sin `id`, todas las pendientes de golpe.
 *
 * Devuelve el contador ya recalculado y no las filas: quien llama a esto es la campana o la pantalla
 * al abrirse, y lo unico que necesita repintar es el globo.
 */
export const readEvents =
  ({ events }) =>
  async (userId, id = null) => {
    await events.markRead(userId, id)
    return { unread: await events.unreadCount(userId) }
  }
