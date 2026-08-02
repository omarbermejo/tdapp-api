/**
 * Un cronometro por PERSONA, no por tarea.
 *
 * Hasta ahora `started_at` y `elapsed_seconds` vivian en la fila de la tarea y el indice unico
 * `tasks_one_running` estaba keyeado por `tasks.user_id`, o sea por el DUEÑO. En cuanto un espacio se
 * comparte, eso falla de tres formas distintas y ninguna es teorica:
 *
 *  1. Si Ana cronometra una tarea de Omar, el indice ocupa la ranura de OMAR: Omar no puede arrancar
 *     su propio cronometro y recibe un 409 que no tiene forma de entender.
 *  2. `findRunning(userId)` busca en `tasks WHERE user_id = ?`, asi que el cronometro que Ana tiene
 *     corriendo en una tarea ajena NO aparece como suyo: su pantalla de enfoque sale vacia mientras el
 *     reloj corre.
 *  3. El contador es uno solo por fila, asi que dos personas en la misma tarea se suman los minutos
 *     entre ellas.
 *
 * Las dos columnas viejas se eliminan en la misma migracion: dejarlas seria tener dos fuentes de
 * verdad para "esto esta corriendo", y la que quedara obsoleta es justo la que el codigo viejo lee.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE task_timers (
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at      TEXT,
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, user_id)
  )`)

  /**
   * Un solo cronometro corriendo por PERSONA. Es el mismo backstop que `tasks_one_running`, movido a
   * donde ahora significa algo: `toggleTimer` hace dos escrituras sin transaccion y este indice es lo
   * que impide que una carrera deje dos relojes en marcha.
   */
  await knex.raw(
    'CREATE UNIQUE INDEX task_timers_one_running ON task_timers(user_id) WHERE started_at IS NOT NULL'
  )

  // Lo que ya estaba cronometrado se muda entero, atribuido a su dueño — hasta hoy era el unico que
  // podia cronometrar, asi que la equivalencia es exacta.
  await knex.raw(`INSERT INTO task_timers (task_id, user_id, started_at, elapsed_seconds)
    SELECT id, user_id, started_at, elapsed_seconds FROM tasks
    WHERE started_at IS NOT NULL OR elapsed_seconds > 0`)

  // El indice viejo cuelga de una columna que esta a punto de irse: se quita antes.
  await knex.raw('DROP INDEX IF EXISTS tasks_one_running')
  await knex.raw('ALTER TABLE tasks DROP COLUMN started_at')
  await knex.raw('ALTER TABLE tasks DROP COLUMN elapsed_seconds')
}

/**
 * Solo para dev y para los tests. Devuelve las columnas y el indice, y remonta lo que hubiera — pero
 * aplasta los cronometros de varias personas en uno: se queda el del dueño de la tarea, que es lo
 * unico que el esquema viejo sabe representar.
 */
export async function down(knex) {
  await knex.raw('ALTER TABLE tasks ADD COLUMN started_at TEXT')
  await knex.raw('ALTER TABLE tasks ADD COLUMN elapsed_seconds INTEGER NOT NULL DEFAULT 0')
  await knex.raw(`UPDATE tasks SET
    started_at = (SELECT tm.started_at FROM task_timers tm
                   WHERE tm.task_id = tasks.id AND tm.user_id = tasks.user_id),
    elapsed_seconds = COALESCE((SELECT tm.elapsed_seconds FROM task_timers tm
                   WHERE tm.task_id = tasks.id AND tm.user_id = tasks.user_id), 0)`)
  await knex.raw(
    'CREATE UNIQUE INDEX tasks_one_running ON tasks(user_id) WHERE started_at IS NOT NULL'
  )
  await knex.raw('DROP TABLE task_timers')
}
