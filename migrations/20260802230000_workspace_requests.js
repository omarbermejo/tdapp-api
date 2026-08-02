/**
 * Solicitudes para entrar a un espacio.
 *
 * Hasta ahora un codigo entraba DIRECTO: quien lo tuviera se hacia miembro sin que el dueño se
 * enterara. Eso valia cuando un codigo se escribia a mano y se pasaba de boca en boca; deja de valer
 * en cuanto se convierte en un link y un QR — un enlace reenviado por WhatsApp mete gente al espacio
 * sin que nadie apruebe nada.
 *
 * **Solo los codigos ABIERTOS pasan por aqui.** Un codigo atado a un correo ya es una invitacion
 * nominal: el dueño escribio esa direccion, asi que pedirle que ademas apruebe seria preguntarle dos
 * veces lo mismo. Ese sigue entrando directo. La regla vive en `accept-invite`, no en el esquema.
 *
 * `UNIQUE(workspace_id, user_id)`: tocar el enlace tres veces no son tres solicitudes. Y el `code` se
 * guarda para poder consumirlo al aprobar — la invitacion NO se borra al solicitar, porque una
 * solicitud rechazada no puede haber quemado el codigo de nadie.
 */
export async function up(knex) {
  await knex.raw(`CREATE TABLE workspace_requests (
    id           INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workspace_id, user_id)
  )`)
  // La pregunta que se hace en cada carga de novedades es "que solicitudes tiene MI espacio".
  await knex.raw('CREATE INDEX workspace_requests_space ON workspace_requests(workspace_id)')
}

export async function down(knex) {
  await knex.raw('DROP INDEX workspace_requests_space')
  await knex.raw('DROP TABLE workspace_requests')
}
