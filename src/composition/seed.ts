import type { UseCases } from './container.js';
import { actorId } from '../domain/inbox/value-objects/ActorId.js';
import { title } from '../domain/inbox/value-objects/Title.js';

/** Demo data for STORE=memory, so `npm run dev` shows a populated inbox immediately. */
export async function seedDemoData(useCases: UseCases): Promise<void> {
  const ana = actorId('ana.silva');
  const items = [
    { kind: 'approve_expense' as const,      t: 'Expense EXP-1042 — $420 travel to Lisbon', p: 'high' as const },
    { kind: 'review_deployment' as const,    t: 'Deploy payments-api v2.14.0 to production', p: 'urgent' as const },
    { kind: 'upload_documentation' as const, t: 'Upload Q3 SOC2 evidence pack',              p: 'normal' as const },
    { kind: 'complete_onboarding' as const,  t: 'Finish onboarding checklist for B. Oyelaran', p: 'low' as const },
  ];

  for (const item of items) {
    await useCases.createInboxItem.execute({
      kind: item.kind, title: title(item.t), assignee: ana, priority: item.p, dueAt: null,
    });
  }
}
