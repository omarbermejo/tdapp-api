import { makeDevice, toPublicDevice } from '../domain/device.js'

/** Guarda el push token de Expo. El mismo token siempre pertenece al ultimo usuario que entro. */
export const registerDevice =
  ({ devices }) =>
  async (userId, input) => {
    const saved = await devices.upsert(userId, makeDevice(input))
    return { device: toPublicDevice(saved) }
  }
