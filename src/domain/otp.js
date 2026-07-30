import { randomInt } from 'node:crypto'

/** El unico proposito por ahora; la columna existe para que "olvide mi contraseña" reuse la tabla. */
export const EMAIL_VERIFY = 'email_verify'

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
