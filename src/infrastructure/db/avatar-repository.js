/**
 * Las caras que cada persona ya eligio.
 *
 * No guarda si un logro esta cumplido — eso se deriva de `tasks` en cada lectura. Aqui solo vive la
 * decision, que es lo unico que no se puede recalcular.
 */
export function createAvatarRepository(db) {
  const byUser = db.prepare('SELECT milestone, avatar FROM user_avatars WHERE user_id = ?')

  /**
   * `OR IGNORE` y no `OR REPLACE`: reclamar dos veces el mismo logro no cambia la cara elegida.
   *
   * La PK (user_id, milestone) hace que el segundo intento choque, y el IGNORE lo convierte en cero
   * filas en vez de un error — de ahi sale el `false` que el caso de uso traduce a un 409. Con
   * REPLACE, un doble toque cambiaria la cara sin que nadie lo pidiera.
   */
  const claim = db.prepare(
    'INSERT OR IGNORE INTO user_avatars (user_id, milestone, avatar) VALUES (?, ?, ?)'
  )

  return {
    /** Map de id de logro -> cara elegida. Map y no objeto: es lo que consume `avatarState`. */
    async claimedBy(userId) {
      return new Map(byUser.all(userId).map((row) => [row.milestone, row.avatar]))
    },

    /** `true` si la fila es nueva; `false` si ese logro ya estaba reclamado. */
    async claim(userId, milestone, avatar) {
      return claim.run(userId, milestone, avatar).changes > 0
    },
  }
}
