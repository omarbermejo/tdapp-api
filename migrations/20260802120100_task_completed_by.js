/**
 * Quien cerro la tarea.
 *
 * Hasta ahora no hacia falta: una tarea solo la podia cerrar su dueño, asi que `completed_at` bastaba y
 * la racha se contaba por `user_id`. En cuanto un espacio se comparte eso deja de ser cierto — una
 * tarea creada por Omar y cerrada por Ana contaria para Omar, y con ella su racha y sus logros.
 *
 * Es la columna que hace que el merito sea de quien trabaja.
 */
export async function up(knex) {
  // SQLite acepta REFERENCES en un ADD COLUMN mientras el default sea NULL. Mismo caso exacto que
  // `tasks.workspace_id` en 20260801120000. `SET NULL` y no CASCADE: si alguien borra su cuenta, la
  // tarea sigue cerrada — lo que se pierde es de quien fue el merito, no el hecho.
  await knex.raw(`ALTER TABLE tasks ADD COLUMN completed_by INTEGER
    REFERENCES users(id) ON DELETE SET NULL`)

  /**
   * **Esta sentencia no puede fallar.**
   *
   * La racha pasa a contarse por `completed_by`, y sin el relleno la historia entera lo tendria en
   * NULL: todo el mundo abriria la app el dia del despliegue con la racha en cero y el contador de
   * logros vacio. Y no hay vuelta atras — `openDatabase` lanza si la base trae migraciones que el
   * codigo no conoce, y en produccion no existe rollback.
   *
   * Hasta hoy solo el dueño podia cerrar, asi que `user_id` ES quien la cerro. La equivalencia es
   * exacta, no una aproximacion.
   */
  await knex.raw(`UPDATE tasks SET completed_by = user_id WHERE status = 'done'`)
}

/** Solo para dev y para los tests. */
export async function down(knex) {
  await knex.raw('ALTER TABLE tasks DROP COLUMN completed_by')
}
