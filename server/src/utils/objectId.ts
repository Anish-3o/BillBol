// A 24-character hex string, the text form of a MongoDB ObjectId.
// Checking ids from tokens and URLs up front turns a bad id into a clean 401/404
// instead of a Mongoose CastError (500) further down.
export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}
