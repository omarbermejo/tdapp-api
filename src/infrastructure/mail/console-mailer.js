/**
 * Degradacion cuando no hay RESEND_API_KEY. No revienta al arrancar como JWT_SECRET porque
 * sin secreto la seguridad es mentira, mientras que sin Resend el peor caso es un codigo en
 * la consola del dev.
 *
 * ponytail: el techo es que en produccion nadie se entera. Camino: fallar al arrancar cuando
 * NODE_ENV sea production.
 */
export const createConsoleMailer = () => ({
  async sendVerificationCode({ to, code, minutes }) {
    console.warn(
      `RESEND_API_KEY vacio: el codigo NO se envio por correo.\n  para: ${to}\n  codigo: ${code} (vence en ${minutes} min)`
    )
  },
})
