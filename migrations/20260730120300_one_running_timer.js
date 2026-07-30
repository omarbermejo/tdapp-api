/**
 * Un solo timer corriendo por usuario, impuesto en la base.
 *
 * toggle-timer.js ya devuelve 409 por la via amable, pero son dos statements sin transaccion:
 * dos "start" concurrentes pueden pasar el chequeo los dos. Este indice es el backstop.
 */
export async function up(knex) {
  // Antes de imponer el invariante hay que cumplirlo: se queda corriendo el timer mas viejo.
  await knex.raw(`UPDATE tasks SET started_at = NULL
     WHERE started_at IS NOT NULL
       AND id NOT IN (SELECT MIN(id) FROM tasks WHERE started_at IS NOT NULL GROUP BY user_id)`)

  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS tasks_one_running ON tasks(user_id) WHERE started_at IS NOT NULL'
  )
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS tasks_one_running')
}
