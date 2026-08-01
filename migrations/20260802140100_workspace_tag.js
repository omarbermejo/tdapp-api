/**
 * De que es un espacio: su clasificacion.
 *
 * Es lo que reemplaza a la pregunta de focos del onboarding, pero movida a donde significa algo — un
 * proyecto ES de estudio o de casa; una persona no "es" de tres cosas.
 *
 * De aqui salen el icono y el color de las tareas del espacio que no traigan foco propio, asi que es la
 * columna con mas superficie visible de todo el trabajo.
 *
 * NULLABLE, y eso importa: `makeWorkspace` valida el MERGE de `{...base, ...input}`, asi que una columna
 * obligatoria sin default haria que el PATCH de todo espacio ya existente devolviera 400.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE workspaces ADD COLUMN tag TEXT')
}

/** Solo para dev y para los tests. */
export async function down(knex) {
  await knex.raw('ALTER TABLE workspaces DROP COLUMN tag')
}
