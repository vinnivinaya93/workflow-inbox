import type { Pool, PoolClient } from 'pg';
import type { EventPublisher } from '../../../application/ports/EventPublisher.js';
import type { TransactionContext, UnitOfWork } from '../../../application/ports/UnitOfWork.js';
import { OutboxEventPublisher } from './OutboxEventPublisher.js';
import { PgInboxItemRepository } from './PgInboxItemRepository.js';

export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly pool: Pool,
    /** Lets the composition root wrap the outbox publisher with metrics without this file knowing. */
    private readonly decorate: (publisher: EventPublisher) => EventPublisher = (p) => p,
  ) {}

  async transaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ctx: TransactionContext = {
        inboxItems: new PgInboxItemRepository(client),
        events: this.decorate(new OutboxEventPublisher(client)),
      };
      const result = await work(ctx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined); // never mask the original error
      throw error;
    } finally {
      client.release();
    }
  }
}
