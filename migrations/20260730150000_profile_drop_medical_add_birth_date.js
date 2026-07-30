/**
 * Saca los dos datos medicos del perfil y cambia el ano de nacimiento por la fecha completa.
 *
 * `diagnosis` y `treatment` eran las dos preguntas mas incomodas del onboarding y no hacen
 * falta para ayudar a alguien a organizarse: guardar dato clinico que nadie lee es solo
 * responsabilidad regalada. Las 5 filas existentes estaban en 'undisclosed', asi que no se
 * pierde ninguna respuesta real.
 *
 * `birth_year` -> `birth_date` (TEXT, ISO 'YYYY-MM-DD'): el ano solo no alcanza para felicitar
 * a alguien el dia que le toca. Se hace DROP + ADD en vez de RENAME COLUMN porque el tipo
 * declarado tiene que pasar de INTEGER a TEXT, y los 5 valores guardados eran NULL: no hay
 * nada que convertir.
 */
const DROPPED = ['diagnosis', 'treatment', 'birth_year']

export async function up(knex) {
  for (const column of DROPPED) {
    await knex.raw(`ALTER TABLE user_profiles DROP COLUMN ${column}`)
  }
  await knex.raw('ALTER TABLE user_profiles ADD COLUMN birth_date TEXT')
}

export async function down() {
  throw new Error('DROP COLUMN no se revierte: restaura el archivo .db desde su copia')
}
