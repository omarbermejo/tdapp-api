/**
 * El indice que le faltaba a `tasks(workspace_id)`.
 *
 * Sin el, `EXPLAIN QUERY PLAN` de la consulta que pinta el anillo de progreso de cada espacio
 * responde `SCAN t LEFT-JOIN`: para saber cuantas tareas tiene un espacio, SQLite recorre la tabla
 * `tasks` ENTERA. Y el coste crece con el total de tareas del sistema, no con el numero de espacios
 * — con un solo espacio y cero resultados sigue leyendo todas las filas.
 *
 * Lo pagan `GET /workspaces`, `GET /workspaces/:id`, las tres veces que
 * `GET /workspaces/collaborators` toca `tasks`, y `GET /tasks?workspaceId`.
 *
 * **Dos columnas y no una.** `status` no esta ahi por el WHERE sino para volver el indice COVERING:
 * la consulta pide `COUNT(t.id)` y `SUM(t.status = 'done')`, asi que con la segunda columna dentro
 * del indice el motor responde el progreso sin abrir ni una fila de la tabla. Con `(workspace_id)` a
 * secas encontraria las filas rapido pero tendria que ir a buscar el `status` de cada una.
 *
 * Una sentencia por knex.raw(): el dialecto better-sqlite3 de dev y de los tests ejecuta raw con
 * `connection.prepare()`, que solo acepta una.
 */
export async function up(knex) {
  await knex.raw('CREATE INDEX tasks_workspace ON tasks(workspace_id, status)')
}

export async function down(knex) {
  await knex.raw('DROP INDEX tasks_workspace')
}
