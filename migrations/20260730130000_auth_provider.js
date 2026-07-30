/**
 * De donde viene cada cuenta, como dato y no como string magico.
 *
 * Hasta ahora "esta cuenta entra con Google" se deducia de que password_hash tuviera un
 * centinela imposible de igualar. Ese centinela ya cambio de valor una vez ('google' ->
 * 'oauth'), asi que las filas viejas y las nuevas decian lo mismo de dos formas distintas.
 */
export async function up(knex) {
  await knex.raw("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password'")

  // Un hash de scrypt siempre es 'salt:key'. Lo que no lleva ':' es un centinela de OAuth,
  // y cuando el centinela nombra al proveedor ('google'/'apple') se aprovecha.
  await knex.raw(`UPDATE users SET auth_provider = CASE
    WHEN password_hash IN ('google', 'apple') THEN password_hash
    WHEN password_hash NOT LIKE '%:%'         THEN 'oauth'
    ELSE 'password' END`)
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN auth_provider')
}
