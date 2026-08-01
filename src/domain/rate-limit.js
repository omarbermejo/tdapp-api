/**
 * El freno de la fuerza bruta. Dominio puro: la politica y la cuenta, sin Express y sin reloj propio.
 *
 * El README lo pedia desde el principio ("Sin rate limit en /auth/login. Agregar antes de exponerlo a
 * internet") y se paga justo al salir a producción: sin esto, cualquiera prueba contraseñas contra
 * `/auth/login` a la velocidad que le dé la red.
 */

/**
 * Ocho intentos por ventana de diez minutos.
 *
 * El numero sale de los dos lados: quien de verdad olvido su contraseña prueba tres o cuatro veces
 * antes de rendirse, asi que ocho no estorba a nadie; y ocho cada diez minutos son 48 por hora, que
 * como ataque no sirve para nada.
 */
export const LOGIN_POLICY = { tries: 8, windowMs: 10 * 60_000 }

/**
 * Cinco codigos de recuperacion por cuarto de hora, contados SOLO por correo.
 *
 * La asimetria con el login es a proposito. Alla el limite por correo no basta porque quien barre
 * mil correos desde una IP esta probando CONTRASEÑAS y no toca el limite de ninguno. Aqui no hay
 * secreto que adivinar: lo que se protege es la bandeja de otra persona y lo que pagamos por
 * correo enviado, y las dos cosas son por correo. Contar tambien por IP frenaria a una oficina
 * entera detras de un NAT sin evitar ni un correo de mas.
 *
 * Cinco es holgado para quien de verdad no recibe el codigo, y encima el cooldown del OTP ya topa
 * cada cuenta a un correo por minuto: este limite es el techo de la hora, no el del minuto.
 */
export const FORGOT_POLICY = { tries: 5, windowMs: 15 * 60_000 }

/**
 * Diez intentos de codigo de invitacion cada diez minutos.
 *
 * Mas holgado que el login (8) a proposito: seis caracteres dictados por telefono se teclean mal dos
 * veces sin que pase nada raro, y quien se equivoca aqui no esta atacando nada.
 *
 * Y mas estricto de lo que parece, porque cuenta LAS DOS PUERTAS JUNTAS: la vista previa y el aceptar
 * suben el mismo contador. Con un contador propio, la vista previa seria un oraculo gratis — se podrian
 * enumerar codigos sin gastar ni un intento del que de verdad importa.
 *
 * Sobre mil millones de combinaciones, diez intentos cada diez minutos son 1e-8 de acertar por ventana.
 */
export const JOIN_POLICY = { tries: 10, windowMs: 10 * 60_000 }

/**
 * Techo de claves vigiladas.
 *
 * Sin el, el propio limitador es el agujero: un atacante rotando IPs mete una entrada nueva por intento
 * y llena la memoria del proceso. Al llegar al techo se barre lo caducado, y si aun asi no cabe, la
 * clave mas vieja cede su sitio — perder el historial de alguien que no ha vuelto en diez minutos no
 * tiene coste.
 */
const MAX_KEYS = 10_000

/**
 * Un limitador de ventana deslizante.
 *
 * Deslizante y no por cubos fijos: con cubos, ocho intentos al final de un cubo y ocho al principio del
 * siguiente son dieciseis seguidos, que es justo lo que se quiere evitar.
 *
 * El reloj entra por parametro en cada llamada para que los tests no tengan que esperar diez minutos.
 */
export function createLimiter({ tries, windowMs }) {
  /** clave -> instantes de los intentos que siguen dentro de la ventana. */
  const hits = new Map()

  const fresh = (list, now) => list.filter((at) => now - at < windowMs)

  const sweep = (now) => {
    for (const [key, list] of hits) {
      const alive = fresh(list, now)
      if (alive.length === 0) hits.delete(key)
      else hits.set(key, alive)
    }
  }

  return {
    /**
     * Registra un intento y dice si esa clave ya se paso.
     *
     * Cuenta ANTES de comparar, asi que el octavo intento pasa y el noveno ya no.
     */
    hit(key, now) {
      if (hits.size >= MAX_KEYS && !hits.has(key)) {
        sweep(now)
        // Sigue lleno: la mas vieja cede el sitio. Los Map de JS iteran en orden de inserción.
        if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value)
      }

      const list = fresh(hits.get(key) ?? [], now)
      list.push(now)
      hits.set(key, list)
      return list.length > tries
    },

    /**
     * Olvida una clave. Se llama al entrar bien: quien se equivoco tres veces y acerto a la cuarta no
     * debe arrastrar esos tres intentos el resto de la ventana.
     */
    clear(key) {
      hits.delete(key)
    },

    /** Cuantos intentos vivos lleva la clave. Para los tests y para depurar. */
    count(key, now) {
      return fresh(hits.get(key) ?? [], now).length
    },

    /** Cuantas claves se estan vigilando. Para comprobar que el techo funciona. */
    get size() {
      return hits.size
    },
  }
}
