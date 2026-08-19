import { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type { Clock } from '../application/ports/Clock.js';
import type { UnitOfWork } from '../application/ports/UnitOfWork.js';
import { CancelInboxItem } from '../application/use-cases/CancelInboxItem.js';
import { ClaimInboxItem } from '../application/use-cases/ClaimInboxItem.js';
import { CompleteInboxItem } from '../application/use-cases/CompleteInboxItem.js';
import { CreateInboxItem } from '../application/use-cases/CreateInboxItem.js';
import { GetInboxItem } from '../application/use-cases/GetInboxItem.js';
import { ListInboxItems } from '../application/use-cases/ListInboxItems.js';
import { ReleaseInboxItem } from '../application/use-cases/ReleaseInboxItem.js';
import { UuidGenerator } from '../infrastructure/id/UuidGenerator.js';
import { MeteredEventPublisher } from '../infrastructure/observability/MeteredEventPublisher.js';
import { InMemoryStore } from '../infrastructure/persistence/memory/InMemoryInboxItemRepository.js';
import { InMemoryUnitOfWork } from '../infrastructure/persistence/memory/InMemoryUnitOfWork.js';
import { PgUnitOfWork } from '../infrastructure/persistence/pg/PgUnitOfWork.js';
import { SystemClock } from '../infrastructure/time/SystemClock.js';

export interface UseCases {
  readonly createInboxItem: CreateInboxItem;
  readonly listInboxItems: ListInboxItems;
  readonly getInboxItem: GetInboxItem;
  readonly claimInboxItem: ClaimInboxItem;
  readonly releaseInboxItem: ReleaseInboxItem;
  readonly completeInboxItem: CompleteInboxItem;
  readonly cancelInboxItem: CancelInboxItem;
}

export interface Container {
  readonly useCases: UseCases;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly checkReadiness: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

export function buildUseCases(uow: UnitOfWork, clock: Clock): UseCases {
  const ids = new UuidGenerator();
  return {
    createInboxItem: new CreateInboxItem(uow, clock, ids),
    listInboxItems: new ListInboxItems(uow),
    getInboxItem: new GetInboxItem(uow),
    claimInboxItem: new ClaimInboxItem(uow, clock),
    releaseInboxItem: new ReleaseInboxItem(uow, clock),
    completeInboxItem: new CompleteInboxItem(uow, clock),
    cancelInboxItem: new CancelInboxItem(uow, clock),
  };
}

export function buildContainer(config: AppConfig, clock: Clock = new SystemClock()): Container {
  if (config.store === 'postgres') {
    const pool = new Pool({ connectionString: config.databaseUrl!, max: 10 });
    const uow = new PgUnitOfWork(pool, (publisher) => new MeteredEventPublisher(publisher));
    return {
      useCases: buildUseCases(uow, clock),
      uow,
      clock,
      checkReadiness: async () => { await pool.query('SELECT 1'); },
      shutdown: () => pool.end(),
    };
  }

  const uow = new InMemoryUnitOfWork(new InMemoryStore());
  return {
    useCases: buildUseCases(uow, clock),
    uow,
    clock,
    checkReadiness: async () => undefined,
    shutdown: async () => undefined,
  };
}
