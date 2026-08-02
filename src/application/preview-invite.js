import { toPublicMember } from '../domain/user.js'

import { resolveInvite } from './accept-invite.js'

/**
 * De que espacio es este codigo, ANTES de entrar.
 *
 * Existe para que nadie acepte a ciegas: teclear seis caracteres y aparecer dentro de algo sin saber
 * que es no es una confirmacion, es un accidente.
 *
 * **No consume la invitacion** — usa la misma escalera que aceptar y para ahi.
 *
 * Lo que devuelve es una fuga CONTROLADA y por eso es tan corta: el nombre del espacio, su icono, su
 * color, quien invita y CUANTOS son. Quien pregunta todavia no es miembro, asi que no ve la lista de
 * quien esta dentro ni el correo al que se ato el codigo.
 */
export const previewInvite =
  ({ invites, workspaces, members, users }) =>
  async (_userId, { code } = {}) => {
    const { invite, workspace } = await resolveInvite({ invites, workspaces }, code)

    const inviter = await users.findById(invite.invitedBy)

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        icon: workspace.icon,
        accent: workspace.accent,
      },
      invitedBy: inviter ? toPublicMember(inviter) : null,
      members: await members.countOf(workspace.id),
    }
  }
