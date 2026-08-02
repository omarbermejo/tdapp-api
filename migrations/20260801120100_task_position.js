/**
 * Orden manual de las tareas dentro de un dia.
 *
 * Nullable a proposito, y el null SIGNIFICA algo: "nadie ha ordenado este dia a mano". El ORDER BY de
 * `listByUser` lo usa para decidir entre el orden que puso la persona y el derivado de la hora, asi
 * que un DEFAULT 0 no seria equivalente — pondria todas las tareas de la historia empatadas en cero y
 * borraria la diferencia entre "lo coloque aqui" y "nunca lo toque".
 *
 * Timestamp posterior al de workspaces porque las dos hacen ALTER TABLE sobre `tasks` y knex las
 * aplica por orden de nombre de archivo.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE tasks ADD COLUMN position INTEGER')
}

/** Solo para dev y tests: en produccion no hay camino de bajada. Ver la migracion de workspaces. */
export async function down(knex) {
  await knex.raw('ALTER TABLE tasks DROP COLUMN position')
}
