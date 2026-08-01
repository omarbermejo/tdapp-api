/**
 * Las invitaciones a un espacio: un codigo de seis caracteres, con o sin correo atado.
 *
 * **El codigo se guarda EN CLARO**, al reves que los OTP, y el argumento es de producto: la pantalla
 * que lo genera tiene que poder volver a enseñarlo. Con un hash solo se puede mostrar una vez y quien
 * cierre la app pierde el codigo que acaba de crear.
 *
 * Lo que lo protege no es el secreto en reposo sino cuatro cosas juntas: 32^6 ≈ mil millones de
 * combinaciones, siete dias de vida, UN solo uso (la fila se borra al aceptar) y el limite de intentos
 * que comparten `/join` y `/join/check`. Un atacante que enumere a ciegas tiene una entre mil millones
 * por intento y diez intentos cada diez minutos.
 *
 * Aparte de `otp_codes` y no una fila mas suya: aquella tiene PK `(user_id, purpose)`, o sea UN codigo
 * vivo por proposito, y se busca por usuario. Una invitacion se busca POR EL CODIGO y hay varias vivas.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE workspace_invites (
    code         TEXT PRIMARY KEY COLLATE NOCASE,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    invited_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email        TEXT COLLATE NOCASE,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // Listar y revocar las de un espacio entran por ahi; el `code` ya tiene su indice por ser la PK.
  await knex.raw('CREATE INDEX workspace_invites_space ON workspace_invites(workspace_id)')
}

/** Solo para dev y para los tests. */
export async function down(knex) {
  await knex.raw('DROP TABLE workspace_invites')
}
