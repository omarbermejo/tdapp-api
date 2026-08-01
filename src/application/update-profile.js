import { isFreeAvatar, ownedAvatars } from '../domain/avatar.js'
import { ForbiddenError, NotFoundError } from '../domain/errors.js'
import { createProfile, toPublicUser } from '../domain/user.js'

/**
 * Guarda el perfil del onboarding y sella onboarded_at la primera vez.
 * Es un PATCH de verdad (mergea sobre lo que ya hay), asi que el mismo endpoint sirve
 * para el onboarding completo y para cambiar un solo campo desde ajustes.
 */
export const updateProfile =
  ({ users, avatars }) =>
  async (userId, patch = {}) => {
    const row = await users.findById(userId)
    if (!row) throw NotFoundError('Usuario no encontrado')

    const current = toPublicUser(row)
    const profile = createProfile(patch, current)

    /**
     * La cara tiene que estar ganada, y eso se comprueba AQUI y no en `createProfile`.
     *
     * `createProfile` es puro — valida forma y catalogo — y esto no es ninguna de las dos cosas: es
     * permiso, y el permiso depende de una tabla. Que la app no pinte las caras bloqueadas no basta;
     * un PATCH a mano las pondria igual, y entonces el candado seria decorativo.
     *
     * Solo se comprueba cuando el avatar CAMBIA: si no, alguien que gano una cara con un logro que
     * un release futuro endurezca no podria volver a guardar su nombre sin perder la cara antes.
     */
    if (profile.avatar && profile.avatar !== current.avatar && !isFreeAvatar(profile.avatar)) {
      const owned = ownedAvatars(await avatars.claimedBy(userId))
      if (!owned.includes(profile.avatar)) throw ForbiddenError('Esa cara todavia no es tuya')
    }

    return { user: toPublicUser(await users.saveProfile(userId, profile)) }
  }
