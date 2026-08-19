import { ZodError } from 'zod';
import { ApplicationError, ConcurrencyConflict, InvalidCursor, ItemNotFound } from '../../application/errors.js';
import { DomainError, ValidationError } from '../../domain/shared/errors.js';
import {
  CompletionConflict, ItemStateConflict, NotAssignedToActor, OutcomeNotAllowed,
} from '../../domain/inbox/errors.js';

export interface FieldError { readonly field: string; readonly message: string }

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly errors?: readonly FieldError[];
}

const TITLES: Record<number, string> = {
  400: 'Invalid request', 403: 'Forbidden', 404: 'Not found',
  409: 'Conflict', 422: 'Unprocessable entity', 500: 'Internal server error',
};

function statusFor(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof ValidationError) return 400;
  if (error instanceof InvalidCursor) return 400;
  if (error instanceof NotAssignedToActor) return 403;
  if (error instanceof ItemNotFound) return 404;
  if (error instanceof ItemStateConflict) return 409;
  if (error instanceof CompletionConflict) return 409;
  if (error instanceof ConcurrencyConflict) return 409;
  if (error instanceof OutcomeNotAllowed) return 422;
  return 500;
}

function codeFor(error: unknown): string {
  if (error instanceof ZodError) return 'REQUEST_VALIDATION_ERROR';
  if (error instanceof DomainError || error instanceof ApplicationError) return error.code;
  return 'INTERNAL_ERROR';
}

export function toProblem(error: unknown, requestId: string, instance: string): ProblemDetails {
  const status = statusFor(error);
  const code = codeFor(error);

  // A 500 means we do not understand the failure, so the client learns nothing beyond that.
  // The real message and stack go to the log, correlated by requestId. ZodError's own
  // `.message` is a JSON dump of its issues array, which is already surfaced field-by-field
  // in `errors` below — repeating it here would just be noise.
  const detail =
    status === 500
      ? 'An unexpected error occurred.'
      : error instanceof ZodError
        ? 'The request did not match the expected shape; see errors for details.'
        : ((error as Error).message ?? 'Request failed.');

  const errors =
    error instanceof ZodError
      ? error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }))
      : error instanceof ValidationError
        ? [{ field: error.field, message: error.message }]
        : undefined;

  return {
    type: `https://workflow-inbox.internal/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    detail,
    instance,
    requestId,
    ...(errors ? { errors } : {}),
  };
}
