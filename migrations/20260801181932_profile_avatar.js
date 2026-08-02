/**
 * El avatar del perfil: el memoji que la persona elige para su cabecera.
 *
 * Aqui solo vive el IDENTIFICADOR ('memoji-07'), nunca un archivo ni una URL. Las imagenes son
 * assets del bundle de la app (`assets/avatars/memoji-NN.webp`), asi que el backend no tiene nada
 * que servir ni que almacenar: guardar un blob o montar un CDN seria inventar infraestructura para
 * un dato de nueve caracteres que el cliente ya trae en disco.
 *
 * NULLABLE y sin default, al reves que reminder_hour: null NO es un hueco por llenar, es un estado
 * con significado propio — "no eligio" — y la app pinta la inicial del nombre. Un default aqui le
 * pondria cara a todo el mundo sin que nadie la hubiera escogido.
 *
 * Sin CHECK del formato: ALTER TABLE en SQLite no agrega constraints y reconstruir la tabla entera
 * por esto no se paga. El patron lo valida `createProfile`, igual que los catalogos, que tampoco
 * tienen CHECK — la validacion de dominio vive en el dominio.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE user_profiles ADD COLUMN avatar TEXT')
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_profiles DROP COLUMN avatar')
}
