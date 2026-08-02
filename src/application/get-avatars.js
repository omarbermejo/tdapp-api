import { avatarState } from '../domain/avatar.js'

import { avatarProgress } from './avatar-progress.js'

/**
 * El vestidor completo: que caras hay libres, que logros van y cuales estan esperando eleccion.
 *
 * Todo en una llamada porque la pantalla necesita las tres cosas a la vez para pintar una sola
 * rejilla — separar el catalogo del avance obligaria a la app a cruzarlos, que es justo la logica
 * que no puede vivir alli: si la app decide que esta desbloqueado, el candado es decorativo.
 */
export const getAvatars =
  ({ tasks, avatars }) =>
  async (userId, date) => {
    const [progress, claimed] = await Promise.all([
      avatarProgress({ tasks }, userId, date),
      avatars.claimedBy(userId),
    ])

    return avatarState({ progress, claimed })
  }
