export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** Dotted, past-tense, stable across refactors: it is a published contract. */
  readonly name: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
