import { AppError } from '../../domain/errors.js'

export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.fields && { fields: err.fields }) })
  }
  console.error(err)
  res.status(500).json({ error: 'Algo se rompio de nuestro lado' })
}
