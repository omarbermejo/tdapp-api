/**
 * Las novedades: que le paso a cada tarea y cuando.
 *
 * Existe como TABLA y no solo como mensajes de socket porque la pantalla necesita historial al
 * abrirla, no solo lo que llegue en vivo mientras esta abierta. Con solo socket, entrar a la campana
 * con la app recien arrancada enseña una lista vacia aunque hayan pasado cosas — y una bandeja sin
 * historia no es una bandeja. El socket es un acelerador de latencia encima de esto; si se borra la
 * capa de tiempo real entera, lo unico que cambia es cuanto tarda en verse.
 *
 * AUTOINCREMENT, al reves que el resto del repo. `INTEGER PRIMARY KEY` a secas es alias de rowid y
 * SQLite RECICLA ids al borrar la cola — es el mismo agujero que obligo a escribir
 * `application/authenticate.js` para `users.id`. Aqui el id viaja al cliente como cursor de
 * paginacion y de recuperacion tras reconectar, asi que un id reciclado haria que un cliente con
 * `since=41` se saltara filas en silencio. Cuesta una tabla `sqlite_sequence` y cierra la clase
 * entera de bug.
 *
 * `task_id` va SIN clave ajena, y es deliberado: con CASCADE, borrar la tarea borraria la noticia de
 * que se borro — justo el evento que mas importa desapareceria con su causa. Con SET NULL se
 * perderia el enlace de todos sus otros eventos. Entero pelado, y el cliente asume que tocar una
 * fila puede dar 404.
 *
 * `task_title` y `workspace_id` estan DESNORMALIZADOS: son el titulo y el sitio EN EL MOMENTO del
 * evento. Sin el titulo, un evento de borrado no tiene nada que pintar, y uno de renombrado
 * enseñaria el nombre nuevo en la fila que anuncia el viejo. De paso el feed se lee de una sola
 * tabla, sin JOIN con `tasks`.
 *
 * `created_at` sin DEFAULT de SQL, al reves que el resto: `datetime('now')` produce
 * '2026-08-01 20:14:33', sin T y sin Z, y esta es la primera pantalla que va a decir "hace 5 min" —
 * `Date.parse` de ese formato en Hermes es indefinido y el resultado sale con horas de error. Lo
 * liga el repositorio en ISO, como ya hace `completed_at`. Y sin DEFAULT, olvidar el bind revienta
 * en vez de guardar el formato malo en silencio.
 *
 * `read_at` por fila y no una marca de agua en `user_profiles`: una columna alli obligaria a tocar
 * PROFILE_COLUMNS, profileValues y el SET del upsert a la vez, y olvidar uno de los tres borra el
 * dato sin error. Aqui el feature entero vive en una tabla y un repositorio.
 *
 * Cada sentencia en su propio knex.raw(): el dialecto better-sqlite3 ejecuta raw con
 * `connection.prepare()`, que solo acepta UNA sentencia.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE task_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    task_id      INTEGER,
    workspace_id INTEGER,
    kind         TEXT NOT NULL,
    task_title   TEXT NOT NULL,
    meta         TEXT,
    created_at   TEXT NOT NULL,
    read_at      TEXT
  )`)

  // El feed se lee siempre "las mias, de la mas nueva a la mas vieja, desde un cursor".
  await knex.raw('CREATE INDEX task_events_feed ON task_events(user_id, id)')

  // El globo de la campana es un COUNT que se resuelve dentro del indice, sin tocar la tabla.
  await knex.raw('CREATE INDEX task_events_unread ON task_events(user_id) WHERE read_at IS NULL')
}

export async function down(knex) {
  await knex.raw('DROP TABLE task_events')
}
