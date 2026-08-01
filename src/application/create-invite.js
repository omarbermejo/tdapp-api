import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js'
import { INVITE_RULES, generateInviteCode, toPublicInvite } from '../domain/invite.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Crea una invitacion a un espacio: siempre un codigo, y ademas un correo si se pide.
 *
 * Invitar es del DUEÑO (`findOwned`, no `findById`): un miembro trabaja en el espacio, pero decidir
 * quien mas entra es administrar. Es el menor privilegio y ahorra un rol que modelar.
 */
export const createInvite =
  ({ workspaces, members, invites, users, mailer }) =>
  async (userId, workspaceId, input = {}) => {
    const workspace = await workspaces.findOwned(userId, workspaceId)
    if (!workspace) throw NotFoundError('Ese espacio no existe')

    let email = String(input.email ?? '').trim().toLowerCase() || null
    if (email && !EMAIL.test(email)) throw ValidationError({ email: 'Ese correo no se ve bien' })

    /**
     * Invitar por `personId` a alguien de "personas con las que trabajaste antes".
     *
     * El correo lo resuelve el SERVIDOR: la lista de colaboradores viaja por `toPublicMember`, que a
     * proposito no lleva correo — un tercero no tiene por que darte el suyo por compartir un espacio.
     * Asi la pantalla puede invitar de un toque sin que la app llegue a conocerlo.
     *
     * `sharesWith` es el permiso, y el mismo mensaje para "no existe" y "no trabajas con esa persona":
     * distinguirlos convertiria esto en un detector de ids validos.
     */
    const personId = Number(input.personId) || null
    if (personId) {
      const person = (await members.sharesWith(userId, personId))
        ? await users.findById(personId)
        : null
      if (!person) throw NotFoundError('Esa persona no existe')
      if (await members.isMember(workspace.id, personId)) {
        throw ConflictError('Esa persona ya está en el espacio')
      }
      email = String(person.email).trim().toLowerCase()
    }

    // Barrer antes de contar: si no, veinte invitaciones vencidas bloquearian el espacio para siempre.
    await invites.sweepExpired()

    /**
     * Reinvitar al mismo correo devuelve el codigo que ya existe en vez de crear otro.
     *
     * Dos codigos vivos para la misma persona no sirven de nada y hacen que revocar "el suyo" sea
     * ambiguo. Y quien vuelve a invitar casi siempre es alguien que no sabe si el primero llego.
     */
    if (email) {
      const live = await invites.liveFor(workspace.id, email)
      if (live) return { invite: toPublicInvite(live), resent: true }
    }

    if ((await invites.countLive(workspace.id)) >= INVITE_RULES.maxLive) {
      throw ConflictError('Ya hay muchas invitaciones abiertas. Revoca alguna antes de crear otra.')
    }

    const saved = await invites.create({
      code: generateInviteCode(),
      workspaceId: workspace.id,
      invitedBy: userId,
      email,
      ttlDays: INVITE_RULES.ttlDays,
    })

    /**
     * El correo sale sin esperar y sin romper la peticion si falla: el codigo YA existe y la pantalla
     * lo va a enseñar de todas formas, asi que un problema con el buzon no puede tumbar la invitacion.
     * Es el mismo trato que `andSync` le da al widget en el cliente.
     */
    if (email) {
      const from = await users.findById(userId)
      const to = await users.findByEmail(email)
      void Promise.resolve(
        mailer.sendInvite({
          to: email,
          name: to?.name ?? null,
          code: saved.code,
          days: INVITE_RULES.ttlDays,
          workspace: workspace.name,
          from: from?.name ?? 'Alguien',
        })
      ).catch(() => {})
    }

    return { invite: toPublicInvite(saved), resent: false }
  }
