import { PASSWORD_RESET } from '../domain/otp.js'

/**
 * "Olvide mi contraseña": manda el codigo al correo.
 *
 * No lanza nunca en el camino normal y el router contesta 202 pase lo que pase. Si un correo sin
 * cuenta diera 404, este endpoint seria un buscador de correos registrados: se pregunta uno a uno
 * y la respuesta lo dice. Por lo mismo no distingue una cuenta de Google — no tiene contraseña que
 * cambiar, pero decirlo confirmaria que existe. Ese silencio lo compensa la app con una linea de
 * copy que se le muestra a todo el mundo igual.
 *
 * `skipIfActive` es lo que sostiene la promesa, no una comodidad: sin el, pedirlo dos veces
 * seguidas daria 429 desde send-verification-code, y un 429 solo puede salir de una cuenta real.
 * Con el, el segundo intento calla y contesta 202 igual — y el codigo que ya tiene en la bandeja
 * sigue sirviendo.
 *
 * ponytail: los tiempos no se igualan. Una cuenta real gasta un scrypt (~100ms) al hashear el
 * codigo y una inexistente no, asi que la diferencia se puede medir. Techo: contestar 202 antes de
 * mandar el correo lo taparia, pero entonces un fallo de Resend se vuelve invisible — y ese mismo
 * 502 tambien solo aparece en cuentas reales. Se prefiere que el fallo se vea.
 */
export const forgotPassword =
  ({ users, sendCode }) =>
  async ({ email } = {}) => {
    const found = await users.findByEmail(typeof email === 'string' ? email.trim().toLowerCase() : '')
    if (found?.authProvider !== 'password') return

    await sendCode(found, { purpose: PASSWORD_RESET, skipIfActive: true })
  }
