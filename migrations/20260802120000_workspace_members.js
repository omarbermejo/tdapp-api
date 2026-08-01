/**
 * Quien pertenece a un espacio de trabajo.
 *
 * Es la tabla que convierte un espacio de "una carpeta mia" en algo compartido: a partir de aqui, ver
 * y cerrar una tarea ya no depende solo de quien la creo, sino de si estas dentro de su espacio.
 *
 * **`workspaces.user_id` se conserva** y sigue siendo la autoridad de quien ADMINISTRA (renombrar,
 * recolorear, invitar, borrar). No se sustituye por `role = 'owner'` aunque lo parezca: esa columna es
 * la clave ajena que borra el espacio con la cuenta, y tener el dueño en dos sitios que se escriben por
 * separado es el dato que acaba divergiendo. La fila con rol `owner` existe para otra cosa: para que
 * las consultas de pertenencia no tengan que preguntar "¿o eres el dueño?" en cada sitio.
 *
 * Cada sentencia en su propio knex.raw(): el dialecto better-sqlite3 ejecuta raw con
 * `connection.prepare()`, que solo acepta UNA. Varias juntas pasan con el runner de produccion (usa
 * `db.exec`) y revientan en dev y en los tests, que corren knex.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',
    joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  )`)

  /**
   * Por `user_id` primero, al reves que la clave primaria.
   *
   * La consulta caliente no es "quien esta en este espacio" sino la de la frontera — "de que espacios
   * soy miembro" — y esa entra por la persona. Corre dentro de un subselect en cada lectura de tarea
   * por id, asi que es el indice que decide si compartir sale gratis o no.
   */
  await knex.raw('CREATE INDEX workspace_members_user ON workspace_members(user_id, workspace_id)')

  /**
   * El dueño de cada espacio que ya existe pasa a ser miembro suyo.
   *
   * Sin esto, la primera consulta con la frontera nueva dejaria a todo el mundo fuera de sus propios
   * espacios. Es idempotente por la clave primaria: correrlo dos veces no duplica.
   */
  await knex.raw(`INSERT INTO workspace_members (workspace_id, user_id, role)
    SELECT id, user_id, 'owner' FROM workspaces`)
}

/** Solo para dev y para los tests: en produccion no hay camino de bajada (knex es devDependency). */
export async function down(knex) {
  await knex.raw('DROP TABLE workspace_members')
}
