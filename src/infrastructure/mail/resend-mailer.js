import { AppError } from '../../domain/errors.js'
import { EMAIL_VERIFY, PASSWORD_RESET } from '../../domain/otp.js'

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Lo unico que cambia entre los dos correos: el asunto y dos frases. Por eso el mailer sigue
 * teniendo UN metodo y no dos — un codigo de reset ES un codigo de verificacion, verifica que
 * ese buzon es tuyo, y de hecho es por eso que el reset sella email_verified_at.
 *
 * El codigo va en el asunto en los dos: se lee desde la notificacion sin abrir nada, que con
 * TDAH es media batalla. Pero el asunto del reset dice ademas PARA QUE es, porque quien recibe
 * un codigo que no pidio tiene que enterarse sin abrir el correo.
 */
const COPY = {
  [EMAIL_VERIFY]: {
    subject: (code) => `Tu código: ${code}`,
    intro: 'Tu código es',
    tail: 'Si no fuiste tú, ignora este correo.',
  },
  [PASSWORD_RESET]: {
    subject: (code) => `Cambia tu contraseña: ${code}`,
    intro: 'Pediste cambiar tu contraseña. Tu código es',
    tail: 'Si no fuiste tú, ignora este correo: tu contraseña sigue igual.',
  },
}

/**
 * ponytail: fetch directo en vez del SDK de resend, misma decision que google-verifier.js.
 * Es un POST con un header; el SDK arrastra dependencias por eso.
 */
export const createResendMailer = ({ apiKey, from }) => ({
  async sendVerificationCode({ to, name, code, minutes, purpose }) {
    // `??` y no un throw: un proposito nuevo manda el correo de verificacion, que es raro pero
    // legible, en vez de reventar el registro por un texto que falta.
    const copy = COPY[purpose] ?? COPY[EMAIL_VERIFY]

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: copy.subject(code),
        text: `Hola, ${name}.\n\n${copy.intro} ${code}. Vence en ${minutes} minutos.\n\n${copy.tail}`,
        html:
          `<p>Hola, ${name}.</p>` +
          `<p>${copy.intro} <strong style="font-size:24px;letter-spacing:2px">${code}</strong>.</p>` +
          `<p>Vence en ${minutes} minutos. ${copy.tail}</p>`,
      }),
    })

    if (!res.ok) {
      console.error('Resend respondio', res.status, await res.text().catch(() => ''))
      throw new AppError('No pudimos enviar el correo. Intenta de nuevo.', 502)
    }
  },
})
