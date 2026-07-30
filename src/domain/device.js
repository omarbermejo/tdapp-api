import { ValidationError } from './errors.js'

export const PLATFORMS = ['ios', 'android', 'web']

/** Token de Expo Push. Se valida el formato para no guardar basura que luego falle al enviar. */
export function makeDevice(input = {}) {
  const fields = {}
  const token = typeof input.token === 'string' ? input.token.trim() : ''
  const platform = typeof input.platform === 'string' ? input.platform.trim() : ''

  if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token)) {
    fields.token = 'Se espera un Expo push token, ej ExponentPushToken[xxx]'
  }
  if (!PLATFORMS.includes(platform)) fields.platform = `Opcion no valida: ${platform}`

  if (Object.keys(fields).length) throw ValidationError(fields)
  return { token, platform }
}

export const toPublicDevice = (row) => ({
  id: row.id,
  token: row.token,
  platform: row.platform,
  createdAt: row.createdAt,
})
