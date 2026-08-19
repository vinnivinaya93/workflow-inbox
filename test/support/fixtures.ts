import { InMemoryStore } from '../../src/infrastructure/persistence/memory/InMemoryInboxItemRepository.js';
import { InMemoryUnitOfWork } from '../../src/infrastructure/persistence/memory/InMemoryUnitOfWork.js';
import { FixedClock } from '../../src/infrastructure/time/SystemClock.js';
import { buildUseCases, type UseCases } from '../../src/composition/container.js';
import type { DomainEvent } from '../../src/domain/shared/DomainEvent.js';

export interface Harness {
  readonly useCases: UseCases;
  readonly clock: FixedClock;
  readonly published: DomainEvent[];
  readonly store: InMemoryStore;
}

export function harness(at = new Date('2026-08-18T09:00:00.000Z')): Harness {
  const store = new InMemoryStore();
  const published: DomainEvent[] = [];
  const uow = new InMemoryUnitOfWork(store, published);
  const clock = new FixedClock(at);
  return { useCases: buildUseCases(uow, clock), clock, published, store };
}
