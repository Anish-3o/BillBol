// Throw this for expected errors (bad input, not found, forbidden).
// The error handler turns it into a clean JSON response with the right status code.
// `details` is optional extra info for the client, e.g. per-field validation messages.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
