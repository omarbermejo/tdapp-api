import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js'
import { INVITE_CODE, normalizeInviteCode } from '../domain/invite.js'

/**
 * Resuelve un codigo hasta el espacio al que apunta, o lanza.
 *
 * La escalera es la de `verify-email.js`, y el orden importa: el formato se comprueba ANTES de tocar la
 * base, asi que un intento a ciegas no cuesta ni una consulta. Lo comparten aceptar y la vista previa
 * para que las dos digan exactamente lo mismo ante el mismo codigo.
 */
export async function resolveInvite({ invites, workspaces }, code) {
  const typed = normalizeInviteCode(code)
  if (!INVITE_CODE.test(typed)) {
    throw ValidationError({ code: 'Escribe los 6 caracteres del código' })
  }

  const invite = await invites.findByCode(typed)

  /**
   * Vencido y no existe dan el MISMO 404, y el vencido se borra de paso.
   *
   * Distinguirlos convertiria el endpoint en un oraculo: "este codigo existio" ya es informacion sobre
   * un espacio ajeno.
   */
  if (!invite || invite.expired) {
    if (invite) await invites.remove(invite.code)
    throw NotFoundError('Ese código no existe o ya venció')
  }

  const workspace = await workspaces.findAny(invite.workspaceId)
  if (!workspace) throw NotFoundError('Ese código no existe o ya venció')

  return { invite, workspace }
}

/**
 * Entrar a un espacio con un codigo.
 *
 * El codigo es de UN uso: la fila se borra al aceptar. Uno de N usos que se filtra es una puerta
 * abierta durante siete dias, y quien quiera meter a tres personas puede generar tres.
 */
export const acceptInvite =
  ({ invites, workspaces, members, users }) =>
  async (userId, { code } = {}) => {
    const { invite, workspace } = await resolveInvite({ invites, workspaces }, code)

    /**
     * Un codigo atado a un correo solo lo puede usar ese correo.
     *
     * 403 y no 404: aqui el codigo SI es tuyo de leer —lo tienes— y lo que falla es de quien es. Decir
     * "este codigo no es para ti" no filtra nada que quien lo teclea no supiera ya.
     */
    if (invite.email) {
      const me = await users.findById(userId)
      if (me?.email?.toLowerCase() !== invite.email.toLowerCase()) {
        throw ForbiddenError('Ese código es para otra persona')
      }
    }

    if (await members.isMember(workspace.id, userId)) {
      await invites.remove(invite.code)
      throw ConflictError('Ya estás en ese espacio')
    }

    await members.add(workspace.id, userId, 'member')
    await invites.remove(invite.code)

    return { workspace: { id: workspace.id, name: workspace.name, icon: workspace.icon, accent: workspace.accent } }
  }
