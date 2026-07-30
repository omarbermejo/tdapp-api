import { networkInterfaces } from 'node:os'

import { buildApp } from './composition.js'

const { app, settings } = buildApp()

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((i) => i.family === 'IPv4' && !i.internal)?.address

app.listen(settings.port, '0.0.0.0', () => {
  console.log(`API   http://localhost:${settings.port}`)
  if (lanAddress) console.log(`LAN   http://${lanAddress}:${settings.port}  <- usa esta en el celular`)
})
