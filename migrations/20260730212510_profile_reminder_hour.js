/**
 * La hora del recordatorio diario. El perfil ya guardaba la INTENSIDAD del aviso
 * (`reminder_style`) pero no el CUANDO, asi que no habia con que programar nada: la funcion
 * central de la app dependia de un dato que no existia.
 *
 * NOT NULL DEFAULT 9 en un solo ALTER, y el porque de cada mitad:
 *
 * - NOT NULL porque una hora en null no se agenda: seria una fila de perfil inservible para
 *   lo unico que esta columna existe. El resto del perfil obligatorio (focus_areas,
 *   peak_energy, reminder_style, accent_color) tambien es NOT NULL.
 * - DEFAULT 9 porque SQLite no deja agregar una columna NOT NULL sin default constante, y
 *   porque las filas de perfil que ya viven necesitan quedar con una hora usable sin un
 *   UPDATE aparte. Es el mismo 9 de DEFAULT_PROFILE (la manana es cuando mas sirve un
 *   recordatorio diario), repetido aqui solo para este relleno: ningun camino de escritura se
 *   apoya en el, porque el INSERT y el UPSERT de user-repository.js siempre nombran la columna
 *   y el valor viene del dominio. DEFAULT_PROFILE sigue siendo la unica fuente de los
 *   defaults; esto es el backfill de las 5 filas viejas.
 *
 * Sin CHECK (reminder_hour BETWEEN 0 AND 23): ALTER TABLE en SQLite no agrega constraints y
 * reconstruir la tabla por eso no se paga. El rango lo valida createProfile, igual que los
 * catalogos, que tampoco tienen CHECK.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE user_profiles ADD COLUMN reminder_hour INTEGER NOT NULL DEFAULT 9')
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_profiles DROP COLUMN reminder_hour')
}
