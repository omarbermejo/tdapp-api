import { MILESTONES, avatarState, isReached } from '../domain/avatar.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js'

import { avatarProgress } from './avatar-progress.js'

/**
 * Quedarse con una de las tres caras de un logro cumplido.
 *
 * Las cuatro comprobaciones estan aqui y no en el dominio porque tres de ellas necesitan la base: si
 * el logro esta cumplido sale de las tareas, y si ya se reclamo sale de `user_avatars`. Solo la
 * primera —que esa cara pertenezca a ese logro— es puro catalogo.
 *
 * La ultima linea de defensa NO es ninguna de las cuatro sino la PRIMARY KEY (user_id, milestone):
 * dos peticiones simultaneas pasan las cuatro validaciones a la vez, y lo que impide que las dos
 * escriban es la base. Por eso el repositorio usa `INSERT OR IGNORE` y devuelve si escribio, en vez
 * de comprobar antes y confiar.
 */
export const claimAvatar =
  ({ tasks, avatars }) =>
  async (userId, { milestone: id, avatar } = {}, date) => {
    const milestone = MILESTONES.find((m) => m.id === id)
    if (!milestone) throw NotFoundError('Ese logro no existe')

    if (!milestone.choices.includes(avatar)) {
      throw ValidationError({ avatar: 'Esa cara no es de este logro' })
    }

    const progress = await avatarProgress({ tasks }, userId, date)
    // Forbidden y no Validation: los datos estan bien, lo que falta es haberselo ganado.
    if (!isReached(milestone.goal, progress)) throw ForbiddenError('Todavia no desbloqueas ese logro')

    if (!(await avatars.claim(userId, id, avatar))) {
      throw ConflictError('Ya elegiste una cara de ese logro')
    }

    // Devuelve el vestidor entero y no solo la cara: la pantalla que reclama es la misma que pinta la
    // rejilla, y asi no encadena una segunda peticion para verse al dia.
    return avatarState({ progress, claimed: await avatars.claimedBy(userId) })
  }
