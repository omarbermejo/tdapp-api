import { TooManyRequestsError } from '../../domain/errors.js'
import { LOGIN_POLICY, createLimiter } from '../../domain/rate-limit.js'

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
