import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

export interface PgHarness {
  readonly pool: Pool;
  readonly stop: () => Promise<void>;
  readonly truncate: () => Promise<void>;
}

export async function startPostgres(): Promise<PgHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });

  // Same migration file production runs — the schema under test is never a test-only copy.
  await pool.query(readFileSync(new URL('../../migrations/001_init.sql', import.meta.url), 'utf8'));

  return {
    pool,
    truncate: async () => { await pool.query('TRUNCATE inbox_item, outbox_event'); },
    stop: async () => { await pool.end(); await container.stop(); },
  };
}
