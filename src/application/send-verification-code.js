import { TooManyRequestsError } from '../domain/errors.js'
import { EMAIL_VERIFY, generateCode } from '../domain/otp.js'

/**
 * Emite y manda el codigo. Lo comparten el registro, el reenvio y "olvide mi contraseña", y el
 * cooldown vive aqui y no en el caso de uso del reenvio: si viviera alla, volver a registrarse
 * seria un bypass para mandarle correos ilimitados a cualquiera.
 *
 * `purpose` cae en EMAIL_VERIFY para que el registro y el reenvio no tengan que decirlo, y el
 * cooldown resulta ser POR PROPOSITO gratis, porque otps.find ya lo es: tener un codigo de
 * verificacion sin usar no debe frenar el de recuperar contraseña, son dos correos con dos
 * razones distintas.
 */
export const sendVerificationCode =
  ({ hasher, otps, mailer, otpRules }) =>
  async (user, { skipIfActive = false, purpose = EMAIL_VERIFY } = {}) => {
    const active = await otps.find(user.id, purpose)
    const fresh = active && !active.expired && active.ageSeconds < otpRules.resendCooldownSeconds

    // El registro pasa por aqui con skipIfActive: si el codigo que ya recibio sigue vivo,
    // no se manda otro y tampoco se le cobra un 429 — el correo que tiene en la bandeja sirve.
    if (fresh && skipIfActive) return
    if (fresh) {
      const wait = otpRules.resendCooldownSeconds - active.ageSeconds
      throw TooManyRequestsError(`Espera ${wait} segundos para pedir otro codigo`)
    }

    const code = generateCode()
    await otps.issue(user.id, purpose, {
      codeHash: await hasher.hash(code),
      ttlMinutes: otpRules.ttlMinutes,
    })

    // `purpose` viaja al mailer porque es lo unico que cambia entre los dos correos.
    await mailer.sendVerificationCode({
      to: user.email,
      name: user.name,
      code,
      minutes: otpRules.ttlMinutes,
      purpose,
    })
  }
