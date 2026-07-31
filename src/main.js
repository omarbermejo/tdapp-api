import { networkInterfaces } from 'node:os'

import { buildApp } from './composition.js'

const { app, settings } = buildApp()

/**
 * La IP de LAN solo sirve en desarrollo: es la que el celular necesita para alcanzar la Mac. En un
 * contenedor es la IP privada de la red interna de la plataforma — no lleva a ninguna parte y encima
 * ensucia los logs de arranque con algo que parece una direccion util.
 *
 * Se decide por la ausencia de las variables que inyecta cualquier PaaS: si `RAILWAY_ENVIRONMENT` o
 * `NODE_ENV=production` estan puestas, esto no es la maquina de nadie.
 */
const local = !process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production'

const lanAddress = local
  ? Object.values(networkInterfaces())
      .flat()
      .find((i) => i.family === 'IPv4' && !i.internal)?.address
  : undefined

app.listen(settings.port, '0.0.0.0', () => {
  console.log(`API   http://localhost:${settings.port}`)
  if (lanAddress) console.log(`LAN   http://${lanAddress}:${settings.port}  <- usa esta en el celular`)
})
