import { isFreeAvatar, ownedAvatars } from '../domain/avatar.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js'
import { createProfile, toPublicUser } from '../domain/user.js'

/**
 * Guarda el perfil del onboarding y sella onboarded_at la primera vez.
 * Es un PATCH de verdad (mergea sobre lo que ya hay), asi que el mismo endpoint sirve
 * para el onboarding completo y para cambiar un solo campo desde ajustes.
 */
export const updateProfile =
  ({ users, avatars, workspaces }) =>
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

    /**
     * Y el espacio activo tiene que ser uno del que eres MIEMBRO. Mismo argumento que la cara: es
     * permiso y depende de una tabla, asi que no cabe en `createProfile`, que es puro.
     *
     * Solo cuando CAMBIA, por lo mismo: si te sacaran de un espacio que tienes activo, seguir pudiendo
     * guardar tu nombre importa mas que corregir el estado — y de eso ya se encarga el
     * `ON DELETE SET NULL` cuando el espacio desaparece.
     */
    if (
      profile.activeWorkspaceId &&
      profile.activeWorkspaceId !== current.activeWorkspaceId &&
      !(await workspaces.findById(userId, profile.activeWorkspaceId))
    ) {
      throw ValidationError({ activeWorkspaceId: 'Ese espacio no existe' })
    }

    return { user: toPublicUser(await users.saveProfile(userId, profile)) }
  }
