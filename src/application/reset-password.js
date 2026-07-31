import { ValidationError } from '../domain/errors.js'
import { CODE, PASSWORD_RESET } from '../domain/otp.js'
import { passwordProblem, toPublicUser } from '../domain/user.js'

/**
 * Un solo mensaje para "ese correo no tiene cuenta", "esa cuenta es de Google" y "ese codigo esta
 * mal". Los tres tienen que ser indistinguibles o este endpoint deshace el trabajo del 202 de
 * /auth/forgot: un 404 aqui vuelve a convertirlo en un buscador de correos registrados.
 */
const BAD_CODE = 'Ese codigo no es. Pide uno nuevo.'
const BURNED = 'Muchos intentos. Pide un codigo nuevo.'

/**
 * Cambia la contraseña con el codigo que llego al correo, y devuelve sesion nueva: la app entra
 * sin navegar, igual que /auth/verify.
 *
 * Recibe el correo en el body porque todavia no hay sesion de donde sacar de quien es la cuenta.
 * Es la misma escalera de validaciones que verify-email.js, en el mismo orden y por las mismas
 * razones, con dos decisiones propias comentadas abajo.
 */
export const resetPassword =
  ({ users, hasher, otps, tokens, otpRules }) =>
  async ({ email, code, password } = {}) => {
    // La contraseña nueva se valida PRIMERO, antes de mirar el codigo: una contraseña corta es un
    // error de dedo del usuario y no debe quemar el codigo ni uno de los 5 intentos. Es el mismo
    // motivo por el que el formato del codigo se revisa antes de hashear.
    const weak = passwordProblem(password)
    if (weak) throw ValidationError({ password: weak })

    const typed = String(code ?? '').trim()
    if (!CODE.test(typed)) throw ValidationError({ code: 'Escribe los 6 digitos del codigo' })

    const found = await users.findByEmail(typeof email === 'string' ? email.trim().toLowerCase() : '')
    if (found?.authProvider !== 'password') throw ValidationError({ code: BAD_CODE })

    const active = await otps.find(found.id, PASSWORD_RESET)
    if (!active) throw ValidationError({ code: 'Pide un codigo nuevo' })
    if (active.expired) {
      await otps.remove(found.id, PASSWORD_RESET)
      throw ValidationError({ code: 'El codigo vencio. Pide uno nuevo.' })
    }
    if (active.attempts >= otpRules.maxAttempts) throw ValidationError({ code: BURNED })

    if (!(await hasher.verify(typed, active.codeHash))) {
      await otps.addAttempt(found.id, PASSWORD_RESET)
      const left = otpRules.maxAttempts - (active.attempts + 1)
      throw ValidationError({ code: left > 0 ? BAD_CODE : BURNED })
    }

    await otps.remove(found.id, PASSWORD_RESET)

    /**
     * El codigo de email_verify que pudiera quedar pendiente NO se borra: setPassword deja la
     * cuenta verificada y verify-email corta en seco cuando ya lo esta, asi que esa fila queda
     * inerte y muere al vencer. Borrarla seria una escritura mas para nada.
     *
     * ponytail: las sesiones de otros aparatos siguen vivas hasta que venzan. Matarlas pide
     * token_version en users y una lectura de la base en requireAuth, que hoy no lee nada.
     * Quien cambia su contraseña sale de aqui con sesion nueva, que es el caso que importa.
     */
    const row = await users.setPassword(found.id, await hasher.hash(password))
    const user = toPublicUser(row)
    return { user, token: tokens.issue(user) }
  }
