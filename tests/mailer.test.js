import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { EMAIL_VERIFY, PASSWORD_RESET } from '../src/domain/otp.js'
import { createResendMailer } from '../src/infrastructure/mail/resend-mailer.js'

/**
 * El unico test que mira el mailer de verdad.
 *
 * El resto de la suite usa el stub `codeMailer`, asi que el mapa COPY —que decide el asunto y el
 * cuerpo de los dos correos— no lo ejecutaba nadie: era codigo que solo corre en produccion. Y el
 * asunto importa mas de lo normal aqui, porque el codigo va dentro para poder leerse desde la
 * notificacion sin abrir nada.
 *
 * Se stubea `fetch` en vez de tocar la red: lo que se prueba es el cuerpo que armamos, no Resend.
 */
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Devuelve el JSON que el mailer le habria mandado a Resend. */
const capture = async (message, response = { ok: true }) => {
  let sent
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body)
    return { ...response, text: async () => 'boom' }
  }

  const mailer = createResendMailer({ apiKey: 'k', from: 'tdapp <no@reply>' })
  await mailer.sendVerificationCode({ to: 'omar@nexgen.mx', name: 'Omar', minutes: 10, ...message })
  return sent
}

test('el correo de verificacion lleva el codigo en el asunto', async () => {
  const sent = await capture({ code: '123456', purpose: EMAIL_VERIFY })

  assert.equal(sent.subject, 'Tu código: 123456')
  assert.deepEqual(sent.to, ['omar@nexgen.mx'])
  assert.match(sent.text, /Omar/)
  assert.match(sent.text, /123456/)
  assert.match(sent.text, /10 minutos/)
  assert.match(sent.html, /123456/)
})

/**
 * El asunto del reset dice ademas PARA QUE es: quien recibe un codigo que no pidio tiene que
 * enterarse sin abrir el correo, y el cuerpo tiene que dejar claro que su contraseña sigue igual.
 */
test('el correo de reset dice para que es, sin dejar de llevar el codigo', async () => {
  const sent = await capture({ code: '654321', purpose: PASSWORD_RESET })

  assert.equal(sent.subject, 'Cambia tu contraseña: 654321')
  assert.notEqual(sent.subject, 'Tu código: 654321', 'no puede ser el mismo asunto que verificar')
  assert.match(sent.text, /Pediste cambiar tu contraseña/)
  assert.match(sent.text, /tu contraseña sigue igual/)
  assert.match(sent.html, /654321/)
})

/** Un proposito que nadie mapeo manda el correo de verificacion, no un correo vacio. */
test('un proposito desconocido cae en el copy de verificacion', async () => {
  const sent = await capture({ code: '000111', purpose: 'algo_que_no_existe' })

  assert.equal(sent.subject, 'Tu código: 000111')
  assert.match(sent.text, /Tu código es 000111/)
})

test('si Resend falla sale un 502 con mensaje para la persona', async () => {
  await assert.rejects(
    () => capture({ code: '123456', purpose: EMAIL_VERIFY }, { ok: false, status: 422 }),
    (error) => {
      assert.equal(error.status, 502)
      assert.match(error.message, /No pudimos enviar el correo/)
      return true
    }
  )
})
