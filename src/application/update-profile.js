import { NotFoundError } from '../domain/errors.js'
import { createProfile, toPublicUser } from '../domain/user.js'

/**
 * Guarda el perfil del onboarding y sella onboarded_at la primera vez.
 * Es un PATCH de verdad (mergea sobre lo que ya hay), asi que el mismo endpoint sirve
 * para el onboarding completo y para cambiar un solo campo desde ajustes.
 */
export const updateProfile =
  ({ users }) =>
  async (userId, patch = {}) => {
    const row = await users.findById(userId)
    if (!row) throw NotFoundError('Usuario no encontrado')

    const current = toPublicUser(row)
    const profile = createProfile(patch, current)

    return { user: toPublicUser(await users.saveProfile(userId, profile)) }
  }
