import { ConflictError } from '../domain/errors.js'
import { DEFAULT_PROFILE, createIdentity, toPublicUser } from '../domain/user.js'

export const registerUser =
  ({ users, hasher, tokens, sendCode }) =>
  async (input) => {
    const { password, ...identity } = createIdentity(input)
    const existing = await users.findByEmail(identity.email)

    if (existing?.emailVerifiedAt) throw ConflictError('Ese correo ya tiene cuenta. Inicia sesion.')

    const passwordHash = await hasher.hash(password)

    // Si la cuenta existe pero nunca se verifico, el correo sigue siendo de quien lo pruebe:
    // se queda con ella y le llega codigo nuevo. Si no, un squatter bloquearia ese correo
    // para siempre; y de paso cubre el caso "cerre la app en la pantalla del codigo".
    const row = existing
      ? await users.replaceCredentials(existing.id, { name: identity.name, passwordHash })
      : await users.create({ ...identity, passwordHash, profile: DEFAULT_PROFILE })

    // skipIfActive: registrarse otra vez no debe reventar con 429 ni mandar correo de mas.
    await sendCode(row, { skipIfActive: true })

    const publicUser = toPublicUser(row)
    return { user: publicUser, token: tokens.issue(publicUser) }
  }
