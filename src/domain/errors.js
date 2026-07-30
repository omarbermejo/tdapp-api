export class AppError extends Error {
  constructor(message, status = 500, fields) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

export const ValidationError = (fields) =>
  new AppError('Revisa los datos enviados', 400, fields)
export const ConflictError = (message) => new AppError(message, 409)
export const UnauthorizedError = (message = 'No autorizado') => new AppError(message, 401)
export const NotFoundError = (message = 'No encontrado') => new AppError(message, 404)
