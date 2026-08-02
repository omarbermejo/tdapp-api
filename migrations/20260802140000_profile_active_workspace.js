/**
 * En que espacio esta trabajando la persona ahora mismo. `NULL` = en ninguno, o sea el modo general.
 *
 * Vive en el servidor y no en el telefono a proposito: asi el espacio activo viaja entre aparatos, y
 * sobre todo asi **la reconciliacion sale gratis**. `ON DELETE SET NULL` es la regla entera — borrar el
 * espacio (o que te saquen de el, cuando eso exista) devuelve a la persona al modo general sin una sola
 * linea de codigo que mantener. `PRAGMA foreign_keys = ON` esta activo, asi que aplica de verdad.
 *
 * SQLite acepta REFERENCES en un ADD COLUMN mientras el default sea NULL; es el caso, y el precedente
 * exacto es `tasks.workspace_id`.
 */
export async function up(knex) {
  await knex.raw(`ALTER TABLE user_profiles ADD COLUMN active_workspace_id INTEGER
    REFERENCES workspaces(id) ON DELETE SET NULL`)
}

/** Solo para dev y para los tests. */
export async function down(knex) {
  await knex.raw('ALTER TABLE user_profiles DROP COLUMN active_workspace_id')
}
