/**
 * El dia LOCAL en que se cerro una tarea.
 *
 * La racha se calculaba agrupando por `due_date` —el dia para el que la tarea estaba AGENDADA— y no
 * por el dia en que de verdad se cerro. El sintoma: cierras cuatro cosas hoy, ninguna vencia hoy, y
 * la racha no se mueve. Cerrar una tarea de abril le daba credito a abril.
 *
 * La consulta lo hacia a proposito y su docstring lo argumentaba: `completed_at` es un timestamp
 * UTC, asi que agrupar por el haria que cerrar algo a las 11 de la noche en Mexico contara para el
 * dia siguiente. El argumento era bueno; la solucion, no — cambio un error de zona horaria (siete
 * horas al dia) por uno de semantica (todas las tareas fuera de su dia).
 *
 * Esta columna se queda con las dos propiedades: es texto 'YYYY-MM-DD' y la manda el CLIENTE con su
 * dia local, exactamente igual que `due_date`. Ni el servidor adivina zonas ni el credito se va al
 * dia equivocado.
 *
 * **El relleno es aproximado y hay que decirlo.** Para lo ya cerrado no existe el dato local, asi
 * que se deriva de `date(completed_at)`, que es UTC: las tareas cerradas despues de las 17:00 hora
 * de Mexico quedan contadas un dia tarde. Es historico y no se puede recuperar; lo nuevo va bien
 * desde el primer cierre.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE tasks ADD COLUMN completed_date TEXT')
  await knex.raw(
    `UPDATE tasks SET completed_date = date(completed_at)
      WHERE completed_at IS NOT NULL AND status = 'done'`
  )
  // La racha barre un año de dias por usuario: sin esto es un escaneo de la tabla entera por cada
  // GET /me/streak, y esa la pide el inicio, el perfil y el widget.
  await knex.raw('CREATE INDEX tasks_completed_date ON tasks(user_id, completed_date)')
}

export async function down(knex) {
  await knex.raw('DROP INDEX tasks_completed_date')
  await knex.raw('ALTER TABLE tasks DROP COLUMN completed_date')
}
