import { ConflictError, NotFoundError } from '../domain/errors.js'

export const resendCode =
  ({ users, sendCode }) =>
  async (userId) => {
    const row = await users.findById(userId)
    if (!row) throw NotFoundError('Usuario no encontrado')
    if (row.emailVerifiedAt) throw ConflictError('Tu correo ya esta verificado')

    // El cooldown vive en sendCode: aqui solo se decide si tiene sentido pedirlo.
    await sendCode(row)
  }
