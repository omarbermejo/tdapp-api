import { TooManyRequestsError } from '../../domain/errors.js'
import { FORGOT_POLICY, JOIN_POLICY, LOGIN_POLICY, createLimiter } from '../../domain/rate-limit.js'

/**
 * El freno de `/auth/login` como middleware.
 *
 * **Cuenta por IP Y por correo, y frena si cualquiera de los dos se pasa.** Uno solo deja un hueco: por
 * IP nada mas, un atacante con IPs rotatorias pasa libre contra una sola cuenta; por correo nada mas,
 * quien barre miles de correos distintos desde una IP nunca toca el limite de ninguno.
 *
 * En memoria, a proposito: la base es SQLite y el propio README ya acota el despliegue a una instancia
 * ("migrar a Postgres cuando haya mas de una"). Con varias replicas cada una llevaria su cuenta y el
 * limite real seria el doble o el triple — cuando llegue ese dia, esto se muda al almacen compartido.
 * El coste de reiniciarse es que se perdonan los intentos en vuelo, que es aceptable.
 */
export function createLoginLimiter() {
  const limiter = createLimiter(LOGIN_POLICY)

  const middleware = (req, _res, next) => {
    const now = Date.now()
    // `req.ip` es de fiar solo con `trust proxy` puesto (ver `app.js`): sin eso seria la IP del proxy
    // de la plataforma para TODO el trafico, y el primer usuario que se equivocara bloquearia al resto.
    const ip = req.ip ?? 'sin-ip'
    const email = String(req.body?.email ?? '').trim().toLowerCase()

    // Los dos se registran siempre, aunque el primero ya haya frenado: si no, el segundo contador
    // nunca subiria y el hueco volveria a abrirse.
    const byIp = limiter.hit(`ip:${ip}`, now)
    const byEmail = email ? limiter.hit(`email:${email}`, now) : false

    if (byIp || byEmail) {
      // Sin decir cual de los dos limites salto ni cuanto queda: eso le diria al atacante como afinar.
      return next(TooManyRequestsError('Demasiados intentos. Espera unos minutos.'))
    }
    next()
  }

  /** Entrar bien limpia la cuenta de ese correo y esa IP. */
  middleware.forgive = (ip, email) => {
    limiter.clear(`ip:${ip ?? 'sin-ip'}`)
    if (email) limiter.clear(`email:${String(email).trim().toLowerCase()}`)
  }

  return middleware
}

/**
 * El freno de `/auth/forgot`. Sin `forgive`: aqui no hay un "entro bien" que perdone nada.
 *
 * Cuenta solo por correo (ver `FORGOT_POLICY`) y frena ANTES del caso de uso, sin consultar la
 * base. Eso ultimo es deliberado: asi el 429 salta igual con un correo que no existe. Un limitador
 * que solo frenara a las cuentas reales seria el buscador de correos registrados que el 202 de
 * /auth/forgot esta evitando.
 */
/**
 * El freno de los codigos de invitacion.
 *
 * **Una sola instancia para las DOS rutas** (`/join/check` y `/join`), y eso es el punto entero: la
 * vista previa resuelve el mismo codigo que aceptar, asi que con un contador propio seria un oraculo
 * para enumerar codigos sin gastar intentos del que importa. Se monta el MISMO middleware en las dos.
 *
 * Cuenta por IP y por usuario, no por correo: la peticion ya viene autenticada, y el id de la cuenta es
 * una llave estable que sobrevive a rotar de IP. Por eso va DESPUES de `requireAuth`, al reves que el
 * limitador del login.
 */
export function createJoinLimiter() {
  const limiter = createLimiter(JOIN_POLICY)

  const middleware = (req, _res, next) => {
    const now = Date.now()
    const ip = req.ip ?? 'sin-ip'

    // Los dos se registran siempre, aunque el primero ya haya frenado: si no, el segundo contador
    // nunca subiria y el hueco volveria a abrirse. Mismo argumento que en el login.
    const byIp = limiter.hit(`ip:${ip}`, now)
    const byUser = req.userId ? limiter.hit(`user:${req.userId}`, now) : false

    if (byIp || byUser) {
      return next(TooManyRequestsError('Demasiados intentos. Espera unos minutos.'))
    }
    next()
  }

  /** Entrar bien limpia la cuenta: quien se equivoco dos veces y acerto no arrastra los fallos. */
  middleware.forgive = (ip, userId) => {
    limiter.clear(`ip:${ip ?? 'sin-ip'}`)
    if (userId) limiter.clear(`user:${userId}`)
  }

  return middleware
}

export function createForgotLimiter() {
  const limiter = createLimiter(FORGOT_POLICY)

  return (req, _res, next) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    // Sin correo no hay a quien mandarle nada: pasa, y el caso de uso contesta 202 sin hacer nada.
    if (email && limiter.hit(`email:${email}`, Date.now())) {
      return next(TooManyRequestsError('Ya pediste varios codigos. Espera unos minutos.'))
    }
    next()
  }
}
