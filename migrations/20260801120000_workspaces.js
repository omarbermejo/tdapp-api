/**
 * Espacios de trabajo: agrupar tareas por proyecto, no por area de enfoque.
 *
 * Convive con `tasks.focus_area` y no lo reemplaza. Son dos preguntas distintas: el foco es de que
 * TIPO es la tarea (siete valores fijos que la app usa para el color y el icono de la fila), y el
 * espacio es a que PROYECTO pertenece (los crea la persona y son cuantos quiera). Fusionarlos
 * obligaria a migrar las tareas que ya existen y a que el catalogo de colores dejara de ser cerrado.
 *
 * Cada sentencia en su propio knex.raw(): el dialecto better-sqlite3 de knex ejecuta raw con
 * `connection.prepare()`, que solo acepta UNA sentencia. Varias juntas pasan con el runner de
 * produccion (usa `db.exec`) y revientan en dev y en los tests, que corren knex.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE workspaces (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL,
    accent     TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // El orden de las cards lo manda `position`, y siempre se listan por usuario.
  await knex.raw('CREATE INDEX workspaces_user ON workspaces(user_id, position)')

  /**
   * Borrar un espacio NO borra su trabajo: las tareas se quedan, sueltas.
   *
   * `SET NULL` y no `CASCADE` a proposito — perder tareas por reorganizar carpetas es el peor modo de
   * falla posible en una app de tareas. Y funciona de verdad porque `openDatabase` enciende
   * `PRAGMA foreign_keys = ON`; sin eso el SET NULL seria decorativo.
   *
   * SQLite acepta REFERENCES en un ADD COLUMN mientras el default sea NULL, que es justo el caso: una
   * tarea sin espacio es lo normal, no un estado a migrar.
   */
  await knex.raw(`ALTER TABLE tasks ADD COLUMN workspace_id INTEGER
    REFERENCES workspaces(id) ON DELETE SET NULL`)
}

/**
 * Solo para dev y para los tests: en produccion no hay camino de bajada (knex es devDependency y
 * `scripts/migrate.js` solo sabe subir). Si hay que revertir en prod, se restaura el .db.
 */
export async function down(knex) {
  await knex.raw('ALTER TABLE tasks DROP COLUMN workspace_id')
  await knex.raw('DROP TABLE workspaces')
}
