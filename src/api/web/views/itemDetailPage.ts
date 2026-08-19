import type { InboxItemView } from '../../../application/views/InboxItemView.js';
import { attr, esc } from '../escape.js';
import { layout } from './layout.js';

const OUTCOME_LABEL: Record<string, string> = {
  approved: 'Approve', rejected: 'Reject', done: 'Mark as done',
};

export function itemDetailPage(opts: {
  item: InboxItemView;
  actor: string;
  /** Stable per attempt: survives a validation round-trip so a retry is the SAME attempt. */
  idempotencyKey: string;
  flashCode?: string | undefined;
}): string {
  const { item } = opts;
  const canComplete = item.availableActions.includes('complete');
  const canCancel = item.availableActions.includes('cancel');

  const outcomes = item.allowedOutcomes
    .map(
      (o, index) => `
      <label>
        <input type="radio" name="outcome" value="${attr(o)}" ${index === 0 ? 'required' : ''}>
        ${esc(OUTCOME_LABEL[o] ?? o)}
      </label>`,
    )
    .join('');

  const completeForm = `
    <form method="post" action="/items/${attr(item.id)}/complete">
      <input type="hidden" name="idempotencyKey" value="${attr(opts.idempotencyKey)}">
      <fieldset>
        <legend>Decision</legend>
        ${outcomes}
        <p>
          <label for="note">Note ${item.kind.startsWith('approve') || item.kind.startsWith('review') ? '<span class="hint">(required when rejecting)</span>' : '<span class="hint">(optional)</span>'}</label><br>
          <textarea id="note" name="note" rows="3" cols="60" maxlength="1000"
                    aria-describedby="note-hint"></textarea>
          <span id="note-hint" class="hint">Recorded in the audit trail and visible to the requester.</span>
        </p>
        <button type="submit">Submit decision</button>
      </fieldset>
    </form>

    <form method="post" action="/items/${attr(item.id)}/${item.status === 'claimed' ? 'release' : 'claim'}">
      <button type="submit">${item.status === 'claimed' ? 'Release to queue' : 'Claim this item'}</button>
    </form>

    ${
      canCancel
        ? `<form method="post" action="/items/${attr(item.id)}/cancel">
             <label for="cancel-reason">Cancel this item <span class="hint">(reason required)</span></label><br>
             <input type="text" id="cancel-reason" name="reason" maxlength="500" required
                    aria-describedby="cancel-hint">
             <span id="cancel-hint" class="hint">The requester will see this reason.</span>
             <button type="submit">Cancel item</button>
           </form>`
        : ''
    }`;

  const record = item.completion
    ? `<h2>Recorded outcome</h2>
       <dl>
         <dt>Outcome</dt><dd>${esc(item.completion.outcome)}</dd>
         <dt>By</dt><dd>${esc(item.completion.by)}</dd>
         <dt>At</dt><dd><time datetime="${attr(item.completion.at)}">${esc(item.completion.at)}</time></dd>
         ${item.completion.note ? `<dt>Note</dt><dd>${esc(item.completion.note)}</dd>` : ''}
       </dl>`
    : item.cancellation
      ? `<h2>Cancelled</h2><p>${esc(item.cancellation.reason)} — ${esc(item.cancellation.by)}</p>`
      : '';

  const body = `
    <nav><a href="/">← All pending actions</a></nav>
    <h1>${esc(item.title)}</h1>
    <dl>
      <dt>Type</dt><dd>${esc(item.kindLabel)}</dd>
      <dt>Status</dt><dd><span class="status">${esc(item.status)}</span></dd>
      <dt>Assigned to</dt><dd>${esc(item.assignee)}</dd>
      ${item.claimedBy ? `<dt>Held by</dt><dd>${esc(item.claimedBy)}</dd>` : ''}
    </dl>
    ${canComplete ? completeForm : ''}
    ${record}
  `;

  return layout({ title: item.title, flashCode: opts.flashCode, body });
}
