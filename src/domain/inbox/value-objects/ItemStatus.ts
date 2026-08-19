export const ITEM_STATUSES = ['pending', 'claimed', 'completed', 'cancelled'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export function isTerminal(status: ItemStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}
