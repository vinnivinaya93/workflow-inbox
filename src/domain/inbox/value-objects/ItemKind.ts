import { ValidationError } from '../../shared/errors.js';
import type { Outcome } from './Outcome.js';

export const ITEM_KINDS = [
  'approve_expense',
  'review_deployment',
  'upload_documentation',
  'complete_onboarding',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export interface KindPolicy {
  /** A decision needs a verdict; a task just needs doing. */
  readonly isDecision: boolean;
  readonly allowedOutcomes: readonly Outcome[];
  /** Rejecting something without saying why is not a useful audit record. */
  readonly noteRequiredFor: readonly Outcome[];
  readonly label: string;
}

export const KIND_POLICY: Readonly<Record<ItemKind, KindPolicy>> = Object.freeze({
  approve_expense: {
    isDecision: true,
    allowedOutcomes: ['approved', 'rejected'],
    noteRequiredFor: ['rejected'],
    label: 'Approve an expense',
  },
  review_deployment: {
    isDecision: true,
    allowedOutcomes: ['approved', 'rejected'],
    noteRequiredFor: ['rejected'],
    label: 'Review a deployment',
  },
  upload_documentation: {
    isDecision: false,
    allowedOutcomes: ['done'],
    noteRequiredFor: [],
    label: 'Upload documentation',
  },
  complete_onboarding: {
    isDecision: false,
    allowedOutcomes: ['done'],
    noteRequiredFor: [],
    label: 'Complete onboarding',
  },
});

export function itemKind(raw: string): ItemKind {
  const kind = ITEM_KINDS.find((k) => k === raw);
  if (!kind) {
    throw new ValidationError('kind', `expected one of ${ITEM_KINDS.join(', ')}, received "${raw}"`);
  }
  return kind;
}

export function policyFor(kind: ItemKind): KindPolicy {
  return KIND_POLICY[kind];
}
