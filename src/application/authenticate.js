import { UnauthorizedError } from '../domain/errors.js'

/**
 * La cuenta detras del token todavia existe, y es LA MISMA de entonces.
 *
 * Existe porque borrar cuentas abrio un agujero real. `users.id` es `INTEGER PRIMARY KEY` sin
 * AUTOINCREMENT, asi que SQLite **recicla el rowid**: al borrar la cuenta de id mas alto, la
 * siguiente que se registre nace con ese mismo id. Y el JWT dura 30 dias y solo lleva `sub`.
 * Reproducido: borrar la cuenta 1, registrar a otra persona (nace con id 1) y el token de la cuenta
 * muerta leia y escribia los datos de esa persona. Secuestro de cuenta, no fuga teorica.
 *
 * Se comprueban tres cosas, y hacen falta las tres:
 *
 * 1. **Que la fila exista.** Cubre la cuenta borrada mientras nadie herede su id.
 * 2. **Que el correo del token sea el de la fila.** Cubre el caso peligroso —otra persona heredo el
 *    id— y no depende del reloj, que es lo que lo hace la comprobacion buena. El correo ya viajaba
 *    en el token desde siempre y no hay endpoint que lo cambie, asi que en un token legitimo
 *    siempre coincide.
 * 3. **Que el token no sea anterior a la fila** (`iat` contra `created_at`). Cubre lo que el punto 2
 *    no ve: borrarse y volver a registrarse con el MISMO correo, donde el correo coincide pero la
 *    cuenta es otra. En un registro legitimo la fila se inserta antes de firmar el token, asi que
 *    `iat >= created_at` siempre, y `created_at` trunca a segundos hacia abajo.
 *    Su limite: dentro del mismo segundo los dos valores empatan y no discrimina. Se acepta porque
 *    para llegar ahi una persona tendria que borrarse y volver a registrarse en menos de un segundo,
 *    y porque el caso que de verdad importa —que sea OTRA persona— lo agarra el punto 2 sin relojes.
 *
 * Falla como **401 y no 404** a proposito: es lo unico que hace que la app borre su sesion guardada
 * (`auth-context` solo limpia el almacen con un 401). Con un 404 el telefono se quedaria con una
 * sesion muerta en el llavero, pintando el nombre de una cuenta que ya no existe.
 *
 * ponytail: esto mete una lectura por request autenticado, que es justo lo que `requireAuth` evitaba
 * (de ahi que `ev` viaje dentro del token). Es una lectura por PK sobre un SQLite local: microsegundos,
 * y llega con la base ya abierta. Techo real, y es el arreglo de raiz: `AUTOINCREMENT` en `users.id`
 * haria que el id no se reciclara nunca y esta comprobacion sobraria. No se hizo hoy porque en SQLite
 * eso no es un ALTER sino reconstruir la tabla con cuatro hijas colgando de su clave ajena, y no se
 * hace eso sobre las cuentas de produccion en el mismo cambio que abre el agujero.
 */
export const authenticate =
  ({ users }) =>
  async ({ id, email, issuedAt }) => {
    const dead = () => UnauthorizedError('Sesion expirada, vuelve a entrar')

    const row = await users.findById(id)
    if (!row) throw dead()

    /**
     * `email` o `issuedAt` en null = token emitido antes de que esta comprobacion existiera. Se
     * dejan pasar, igual que con `ev` en token-service: caducan solos en 30 dias, y rechazarlos
     * sacaria de la app de golpe a todo el que tenga sesion abierta.
     */
    if (email !== null && email.trim().toLowerCase() !== row.email.trim().toLowerCase()) throw dead()

    // `created_at` es 'YYYY-MM-DD HH:MM:SS' en UTC y sin sufijo: hay que decirle que es UTC o
    // Date.parse lo lee como hora local (seis horas de diferencia aqui).
    const born = Math.floor(Date.parse(`${row.createdAt.replace(' ', 'T')}Z`) / 1000)
    if (issuedAt !== null && Number.isFinite(born) && issuedAt < born) throw dead()

    return row
  }
