/**
 * Las caras ganadas: que avatar eligio esta persona en cada logro.
 *
 * Solo guarda la ELECCION. Si el logro esta cumplido o no NO se guarda: se deriva del conteo de
 * tareas cerradas y de la mejor racha, que son hechos que ya viven en `tasks`. Una columna
 * `unlocked_at` seria un tercer estado capaz de contradecirlos — mismo argumento con el que `stage`
 * no es columna.
 *
 * PRIMARY KEY (user_id, milestone) es la regla del producto escrita en el esquema: de cada logro se
 * elige UNA cara, no las tres. Sin ella, un doble toque o dos peticiones a la vez dejarian dos filas
 * del mismo logro y la persona se llevaria dos premios de uno.
 *
 * `milestone` es texto y no una FK a una tabla de logros: el catalogo vive en `domain/avatar.js`
 * porque es producto, no dato — cambia con cada release y nunca se consulta por si mismo. Una tabla
 * seria un join en cada lectura para leer cinco constantes.
 *
 * Cada sentencia en su propio knex.raw(): el dialecto better-sqlite3 ejecuta raw con
 * `connection.prepare()`, que solo acepta UNA sentencia.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE user_avatars (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    milestone  TEXT NOT NULL,
    avatar     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, milestone)
  )`)

  /**
   * Una cara no se puede reclamar dos veces aunque cambie de logro en un release futuro.
   *
   * Sin esto, mover `memoji-15` del logro de la semana al del mes dejaria a quien ya lo tenia con dos
   * filas de la misma cara y una plaza de logro desperdiciada.
   */
  await knex.raw('CREATE UNIQUE INDEX user_avatars_unique ON user_avatars(user_id, avatar)')
}

export async function down(knex) {
  await knex.raw('DROP TABLE user_avatars')
}
