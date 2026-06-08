/**
 * Raised by repository functions when a row the caller asked to mutate is not
 * visible — either it does not exist or RLS scoped it out (e.g. it belongs to
 * another owner's debate). The withAuth wrapper maps this to a 404 so callers
 * get a clean "Not found" instead of a generic 500 — impl-review F4.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Raised by repository functions when a request is well-formed (passes Zod) but
 * violates a structural domain rule that only a DB read can decide — e.g. a
 * `link` relation pointed at a non-connective target (D1). The withAuth wrapper
 * maps this to 422 (Unprocessable Entity): the syntax is valid, the semantics
 * are not. The message is safe to surface to the client (no Postgres internals).
 */
export class ValidationError extends Error {
  constructor(message = "Validation failed") {
    super(message);
    this.name = "ValidationError";
  }
}
