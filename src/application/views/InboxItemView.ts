import type { InboxItem } from '../../domain/inbox/InboxItem.js';
import { policyFor } from '../../domain/inbox/value-objects/ItemKind.js';

export interface InboxItemView {
  readonly id: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly title: string;
  readonly assignee: string;
  readonly priority: string;
  readonly status: string;
  readonly dueAt: string | null;
  readonly claimedBy: string | null;
  readonly completion: {
    readonly outcome: string;
    readonly note: string | null;
    readonly by: string;
    readonly at: string;
  } | null;
  readonly cancellation: { readonly reason: string; readonly by: string; readonly at: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  /** Told, not inferred: the UI and any API client get the legal next moves from the source of truth. */
  readonly allowedOutcomes: readonly string[];
  readonly availableActions: readonly ('claim' | 'release' | 'complete' | 'cancel')[];
}

function actionsFor(item: InboxItem): InboxItemView['availableActions'] {
  switch (item.status) {
    case 'pending': return ['claim', 'complete', 'cancel'];
    case 'claimed': return ['release', 'complete', 'cancel'];
    default: return [];
  }
}

export function toView(item: InboxItem): InboxItemView {
  const s = item.snapshot();
  const policy = policyFor(s.kind);
  return {
    id: s.id,
    kind: s.kind,
    kindLabel: policy.label,
    title: s.title,
    assignee: s.assignee,
    priority: s.priority,
    status: s.status,
    dueAt: s.dueAt?.toISOString() ?? null,
    claimedBy: s.claimedBy,
    completion: s.completion
      ? {
          outcome: s.completion.outcome,
          note: s.completion.note,
          by: s.completion.by,
          at: s.completion.at.toISOString(),
        }
      : null,
    cancellation: s.cancellation
      ? { reason: s.cancellation.reason, by: s.cancellation.by, at: s.cancellation.at.toISOString() }
      : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    version: s.version,
    allowedOutcomes: policy.allowedOutcomes,
    availableActions: actionsFor(item),
  };
}
