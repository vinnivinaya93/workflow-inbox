export class ApplicationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** No such aggregate. → HTTP 404 */
export class ItemNotFound extends ApplicationError {
  constructor(readonly id: string) {
    super('ITEM_NOT_FOUND', `inbox item "${id}" was not found`);
  }
}

/** Someone else wrote first. → HTTP 409, safe for the caller to retry after re-reading. */
export class ConcurrencyConflict extends ApplicationError {
  constructor(readonly id: string, readonly expectedVersion: number) {
    super(
      'CONCURRENCY_CONFLICT',
      `inbox item "${id}" changed since it was read (expected version ${expectedVersion})`,
    );
  }
}

/** A cursor that did not come from us, or came from an older deploy. → HTTP 400 */
export class InvalidCursor extends ApplicationError {
  constructor(readonly cursor: string) {
    super('INVALID_CURSOR', `cursor "${cursor}" is not valid`);
  }
}
