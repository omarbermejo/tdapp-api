/**
 * Los acentos se renombraron cuando entro la paleta calida (electric/lime/mango/magenta/
 * turquoise -> forest/olive/leaf/clay/copper) y las filas viejas se quedaron con el nombre
 * anterior. Eso rompia dos cosas: la app hacia Accents['electric'] y reventaba al pintar, y
 * createProfile valida el resultado mezclado, asi que esas cuentas ni podian terminar el
 * onboarding — el catalogo ya no tenia ese valor.
 *
 * El mapeo va por familia de color, no por posicion en la lista.
 */
const RENAMED = {
  electric: 'olive', // era el default viejo; olive es el nuevo
  lime: 'leaf',
  mango: 'clay',
  magenta: 'copper',
  turquoise: 'forest',
}

export async function up(knex) {
  for (const [before, after] of Object.entries(RENAMED)) {
    await knex.raw('UPDATE user_profiles SET accent_color = ? WHERE accent_color = ?', [after, before])
  }
}

export async function down() {
  throw new Error('Los nombres viejos de acento no vuelven: ya no existen en el catalogo')
}
