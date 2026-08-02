import { randomInt } from 'node:crypto'

/**
 * El codigo de invitacion a un espacio. Dominio puro: el alfabeto, la forma y las reglas.
 *
 * Es primo del OTP pero no su hermano, y la diferencia importa: un OTP llega a TU buzon y solo tu lo
 * puedes leer, asi que seis digitos bastan. Un codigo de invitacion se dicta en voz alta, se pega en un
 * chat y se puede probar a ciegas contra el servidor — asi que necesita mas entropia y un alfabeto que
 * nadie confunda al teclearlo.
 */

/** Cuantos dias vive. Una semana: suficiente para que alguien lo lea el lunes siguiente. */
export const INVITE_RULES = Object.freeze({
  ttlDays: 7,
  /** Tope de invitaciones vivas por espacio. Sin el, un bucle llena la tabla. */
  maxLive: 20,
})

/**
 * Base32 de Crockford: los diez digitos y las veintidos letras que quedan al quitar I, L, O y U.
 *
 * Sin I ni O porque nadie distingue "I" de "1" ni "O" de "0" al dictar un codigo por telefono, que es
 * exactamente como se va a usar. Sin L por lo mismo (1). Y sin U por la razon original de Crockford:
 * evita que salga escrita una palabrota por accidente.
 *
 * 32^6 = 1 073 741 824. Contra los 10^6 de un OTP son mil veces mas, y hacen falta: un OTP esta ligado
 * a un buzon y este no.
 */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const INVITE_LENGTH = 6
export const INVITE_CODE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/

/** `randomInt` es CSPRNG y no arrastra el sesgo de un modulo, igual que `generateCode` en otp.js. */
export const generateInviteCode = () =>
  Array.from({ length: INVITE_LENGTH }, () => INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)]).join('')

/**
 * Lo que alguien teclea, convertido en lo que se guardo.
 *
 * Nadie escribe un codigo como se lo dictaron: llega con minusculas, con un guion en medio o con
 * espacios de copiarlo mal. Y las cuatro letras que el alfabeto no usa se mapean a lo que la persona
 * quiso decir — quien lee "O" escribe la letra, y el codigo lleva un cero.
 */
export const normalizeInviteCode = (raw) =>
  String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')

/** Lo que ve quien pregunta por un codigo ANTES de entrar. Lo justo para reconocer el espacio. */
export const toPublicInvite = (row) => ({
  code: row.code,
  email: row.email ?? null,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
})
