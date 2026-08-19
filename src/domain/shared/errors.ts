/** Base for every error the domain raises on purpose. Adapters map `code`, not `message`. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** A value object was handed something it cannot represent. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}
