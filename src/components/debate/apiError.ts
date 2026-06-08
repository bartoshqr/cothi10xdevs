/**
 * Error thrown by the persistence fetch wrappers for a non-2xx response. Carries
 * the HTTP status so callers can branch on it — e.g. the store reconciles only on
 * a 409 (a duplicate-relation conflict), not on every failure.
 *
 * Kept in its own module (not `persistence.ts`) so unit tests that `vi.mock` the
 * persistence layer can still import the real class for `instanceof` checks.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
