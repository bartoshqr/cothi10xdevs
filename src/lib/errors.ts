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
