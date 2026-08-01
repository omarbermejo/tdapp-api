/**
 * Degradacion cuando no hay RESEND_API_KEY. No revienta al arrancar como JWT_SECRET porque
 * sin secreto la seguridad es mentira, mientras que sin Resend el peor caso es un codigo en
 * la consola del dev.
 *
 * ponytail: el techo es que en produccion nadie se entera. Camino: fallar al arrancar cuando
 * NODE_ENV sea production.
 */
export const createConsoleMailer = () => ({
  async sendVerificationCode({ to, code, minutes, purpose }) {
    // El proposito se imprime porque ahora hay dos: verificar el correo y cambiar la contraseña.
    // Pueden estar los dos vivos a la vez para la misma cuenta (el PK de otp_codes lo permite), y
    // sin esta linea el log no dice cual de los dos codigos es cual.
    console.warn(
      `RESEND_API_KEY vacio: el codigo NO se envio por correo.\n  para: ${to}\n  codigo: ${code} (${purpose}, vence en ${minutes} min)`
    )
  },

  // El gemelo de `sendInvite` del mailer de verdad. Sin el, en dev sin RESEND_API_KEY invitar
  // revienta con "mailer.sendInvite is not a function".
  async sendInvite({ to, code, days, workspace }) {
    console.warn(
      `RESEND_API_KEY vacio: la invitacion NO se envio por correo.\n  para: ${to}\n  espacio: ${workspace}\n  codigo: ${code} (vence en ${days} dias)`
    )
  },
})
