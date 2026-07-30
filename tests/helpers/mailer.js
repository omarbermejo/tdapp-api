/**
 * Mailer de prueba: guarda lo que se "envio" para poder leer el codigo.
 * Mismo mecanismo con el que se stubean google y apple (overrides de buildApp).
 */
export function codeMailer() {
  const sent = []
  return {
    mailer: {
      sendVerificationCode: async (message) => {
        sent.push(message)
      },
    },
    sent,
    lastCode: () => sent.at(-1)?.code,
  }
}
