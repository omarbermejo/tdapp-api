import { AppError } from '../../domain/errors.js'

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * ponytail: fetch directo en vez del SDK de resend, misma decision que google-verifier.js.
 * Es un POST con un header; el SDK arrastra dependencias por eso.
 *
 * El codigo va en el asunto a proposito: se lee desde la notificacion sin abrir nada,
 * que con TDAH es media batalla.
 */
export const createResendMailer = ({ apiKey, from }) => ({
  async sendVerificationCode({ to, name, code, minutes }) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Tu código: ${code}`,
        text: `Hola, ${name}.\n\nTu código es ${code}. Vence en ${minutes} minutos.\n\nSi no fuiste tú, ignora este correo.`,
        html:
          `<p>Hola, ${name}.</p>` +
          `<p>Tu código es <strong style="font-size:24px;letter-spacing:2px">${code}</strong>.</p>` +
          `<p>Vence en ${minutes} minutos. Si no fuiste tú, ignora este correo.</p>`,
      }),
    })

    if (!res.ok) {
      console.error('Resend respondio', res.status, await res.text().catch(() => ''))
      throw new AppError('No pudimos enviar el correo. Intenta de nuevo.', 502)
    }
  },
})
