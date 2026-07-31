import { randomInt } from 'node:crypto'

/**
 * Para que es el codigo. El PK compuesto de otp_codes es (user_id, purpose), asi que los dos
 * conviven en filas separadas y cada uno lleva su propio contador de intentos y su cooldown:
 * un codigo de verificacion pendiente no frena al de "olvide mi contraseña" ni al contrario.
 *
 * Lo unico que cambia entre los dos es el correo que sale (ver resend-mailer.js). Comparten
 * tabla, TTL, intentos y cooldown a proposito: no hay razon para que uno viva mas que el otro,
 * y partir OTP_RULES en dos serian dos sitios donde ajustar el mismo numero.
 */
export const EMAIL_VERIFY = 'email_verify'
export const PASSWORD_RESET = 'password_reset'

export const OTP_RULES = Object.freeze({
  // 10 minutos aguantan un correo lento y dejan una ventana de ataque corta.
  ttlMinutes: 10,
  // 5 intentos sobre un millon de codigos posibles: 5e-6 de acertar a ciegas.
  maxAttempts: 5,
  resendCooldownSeconds: 60,
})

export const CODE = /^\d{6}$/

/** randomInt es CSPRNG y no tiene el sesgo de un modulo; padStart salva 1 de cada 10 codigos. */
export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
