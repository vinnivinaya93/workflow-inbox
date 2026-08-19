export const FLASH: Record<string, { tone: 'success' | 'error'; text: string }> = {
  completed:   { tone: 'success', text: 'Action completed. Thanks — the requester has been notified.' },
  claimed:     { tone: 'success', text: 'You have claimed this item.' },
  released:    { tone: 'success', text: 'Item released back to the queue.' },
  cancelled:   { tone: 'success', text: 'Item cancelled.' },

  ITEM_COMPLETION_CONFLICT:  { tone: 'error', text: 'This item was already completed. The recorded outcome is shown below.' },
  ITEM_STATE_CONFLICT:       { tone: 'error', text: 'This item is already closed, so it cannot be changed.' },
  ITEM_NOT_ASSIGNED_TO_ACTOR:{ tone: 'error', text: 'Someone else is working on this item.' },
  ITEM_OUTCOME_NOT_ALLOWED:  { tone: 'error', text: 'That outcome needs a note explaining the decision.' },
  CONCURRENCY_CONFLICT:      { tone: 'error', text: 'This item changed while you were reading it. It has been reloaded.' },
  ITEM_NOT_FOUND:            { tone: 'error', text: 'That item no longer exists.' },
  VALIDATION_ERROR:          { tone: 'error', text: 'Please check the form and try again.' },
};

export function flashFor(code: string | undefined): { tone: 'success' | 'error'; text: string } | null {
  if (!code) return null;
  return FLASH[code] ?? { tone: 'error', text: 'Something went wrong. Please try again.' };
}
