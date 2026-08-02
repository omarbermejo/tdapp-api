/**
 * Solo el numero del globo de la campana.
 *
 * Aparte de `listEvents` porque el inicio lo pide en cada foco y no necesita ni una fila: es un
 * COUNT que se resuelve dentro del indice parcial `task_events_unread`.
 */
export const countUnread =
  ({ events }) =>
  async (userId) => ({ unread: await events.unreadCount(userId) })
