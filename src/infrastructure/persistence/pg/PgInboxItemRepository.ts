import type { PoolClient } from 'pg';
import { ConcurrencyConflict } from '../../../application/errors.js';
import type {
  InboxItemFilter, InboxItemRepository, Page, PageRequest,
} from '../../../application/ports/InboxItemRepository.js';
import type { InboxItem } from '../../../domain/inbox/InboxItem.js';
import type { InboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { INBOX_ITEM_COLUMNS, toDomain, toParams, type InboxItemRow } from './inboxItemMapper.js';

export class PgInboxItemRepository implements InboxItemRepository {
  constructor(private readonly client: PoolClient) {}

  async findById(id: InboxItemId): Promise<InboxItem | null> {
    const { rows } = await this.client.query<InboxItemRow>(
      `SELECT ${INBOX_ITEM_COLUMNS} FROM inbox_item WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async insert(item: InboxItem): Promise<void> {
    await this.client.query(
      `INSERT INTO inbox_item (${INBOX_ITEM_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      toParams(item),
    );
  }

  async update(item: InboxItem): Promise<void> {
    const s = item.snapshot();
    const { rowCount } = await this.client.query(
      `UPDATE inbox_item SET
         status = $2, claimed_by = $3, claimed_at = $4,
         outcome = $5, completion_note = $6, completed_by = $7, completed_at = $8,
         idempotency_key = $9,
         cancel_reason = $10, cancelled_by = $11, cancelled_at = $12,
         updated_at = $13, version = $14
       WHERE id = $1 AND version = $15`,
      [
        s.id,
        s.status, s.claimedBy, s.claimedAt,
        s.completion?.outcome ?? null, s.completion?.note ?? null,
        s.completion?.by ?? null, s.completion?.at ?? null, s.completion?.idempotencyKey ?? null,
        s.cancellation?.reason ?? null, s.cancellation?.by ?? null, s.cancellation?.at ?? null,
        s.updatedAt, s.version,
        item.persistedVersion,
      ],
    );

    // 0 rows means either "gone" or "someone wrote first". Both are the caller's cue to
    // re-read; distinguishing them would cost a second query for no actionable difference.
    if (rowCount === 0) throw new ConcurrencyConflict(s.id, item.persistedVersion);
  }

  async search(filter: InboxItemFilter, page: PageRequest): Promise<Page<InboxItem>> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.statuses?.length) { params.push(filter.statuses); where.push(`status = ANY($${params.length})`); }
    if (filter.kinds?.length)    { params.push(filter.kinds);    where.push(`kind   = ANY($${params.length})`); }
    if (filter.assignee)         { params.push(filter.assignee); where.push(`assignee = $${params.length}`); }

    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      params.push(createdAt, id);
      where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
    }

    params.push(page.limit + 1); // over-fetch one to learn whether another page exists
    const { rows } = await this.client.query<InboxItemRow>(
      `SELECT ${INBOX_ITEM_COLUMNS} FROM inbox_item
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    };
  }
}
