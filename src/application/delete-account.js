import { NotFoundError, UnauthorizedError } from '../domain/errors.js'

/**
 * Borrar la cuenta. No hay borrado suave: el CASCADE se lleva tareas, perfil, dispositivos y
 * codigos, y no queda nada que restaurar ni nadie a quien pedirlo.
 *
 * Por eso se pide la contraseña. Es la unica accion de la app que no se puede deshacer, y es lo
 * unico que distingue "yo quiero irme" de "alguien agarro mi telefono desbloqueado" — que a esas
 * alturas ya puede leer y editar todo lo demas, pero no destruirlo.
 *
 * En una cuenta de Google o Apple NO se pide nada: su password_hash es el centinela 'oauth' y no
 * hay contraseña que teclear. Se decide por el proveedor, que es un dato, y no por confiar en que
 * el hash guardado sea inigualable — el mismo criterio que login-user.js.
 */
export const deleteAccount =
  ({ users, hasher }) =>
  async (userId, { password } = {}) => {
    const found = await users.findById(userId)
    if (!found) throw NotFoundError('Esa cuenta no existe')

    if (
      found.authProvider === 'password' &&
      !(await hasher.verify(typeof password === 'string' ? password : '', found.passwordHash))
    ) {
      throw UnauthorizedError('Esa contraseña no es')
    }

    await users.remove(userId)
  }
