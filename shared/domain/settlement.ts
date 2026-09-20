import type { IdentityId, Participant, Payer, Payment } from "./types";
import { sumCents } from "./money";

export type PaymentIssue = "no-payers" | "no-participants" | "share-sum-mismatch";

export const PAYMENT_ISSUE_LABELS: Record<PaymentIssue, string> = {
  "no-payers": "还没有登记付款人",
  "no-participants": "还没有参与人",
  "share-sum-mismatch": "分摊金额合计与付款总额不符",
};

export function payerTotal(payment: Payment): number {
  return sumCents(payment.payers.map((p) => p.amountCents));
}

export function shareTotal(payment: Payment): number {
  if (payment.splitMode === "equal") return payerTotal(payment);
  return sumCents(payment.participants.map((p) => p.shareCents ?? 0));
}

export function validatePayment(payment: Payment): PaymentIssue[] {
  const issues: PaymentIssue[] = [];
  if (payment.payers.length === 0) issues.push("no-payers");
  if (payment.participants.length === 0) issues.push("no-participants");
  if (
    payment.participants.length > 0 &&
    payment.splitMode === "custom" &&
    shareTotal(payment) !== payerTotal(payment)
  ) {
    issues.push("share-sum-mismatch");
  }
  return issues;
}

export function isPaymentValid(payment: Payment): boolean {
  return !payment.voided && validatePayment(payment).length === 0;
}

/** Amount each participant owes, in cents. Only meaningful for valid payments. */
export function computeShares(payment: Payment): Map<IdentityId, number> {
  const shares = new Map<IdentityId, number>();
  if (payment.splitMode === "custom") {
    for (const participant of payment.participants) {
      shares.set(participant.identityId, participant.shareCents ?? 0);
    }
    return shares;
  }

  const total = payerTotal(payment);
  const count = payment.participants.length;
  if (count === 0) return shares;

  const base = Math.floor(total / count);
  let remainder = total - base * count;
  for (const participant of payment.participants) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shares.set(participant.identityId, base + extra);
  }
  return shares;
}

export type PendingRole = "payer" | "participant" | "unknown";

export interface PendingConfirmation {
  identityId: IdentityId;
  paymentId: Payment["id"];
  role: PendingRole;
}

/**
 * Everything a person can be waiting on for one payment:
 * - payer / participant: they are enrolled but have not confirmed the numbers
 * - unknown: they have not reacted to this payment at all yet
 */
export function pendingConfirmationsFor(
  payment: Payment,
  memberIds: IdentityId[],
): PendingConfirmation[] {
  if (payment.voided) return [];

  const roles = new Map<IdentityId, Set<PendingRole>>();
  const involved = new Set<IdentityId>();
  const addRole = (identityId: IdentityId, role: PendingRole) => {
    involved.add(identityId);
    const set = roles.get(identityId) ?? new Set<PendingRole>();
    set.add(role);
    roles.set(identityId, set);
  };

  for (const payer of payment.payers) {
    involved.add(payer.identityId);
    if (!payer.confirmed) addRole(payer.identityId, "payer");
  }
  for (const participant of payment.participants) {
    involved.add(participant.identityId);
    if (!participant.confirmed) addRole(participant.identityId, "participant");
  }

  const declined = new Set(payment.declinedBy);
  for (const memberId of memberIds) {
    if (!involved.has(memberId) && !declined.has(memberId)) {
      addRole(memberId, "unknown");
    }
  }

  const ordered: IdentityId[] = [...memberIds];
  for (const identityId of roles.keys()) {
    if (!ordered.includes(identityId)) ordered.push(identityId);
  }

  const result: PendingConfirmation[] = [];
  const roleOrder: PendingRole[] = ["payer", "participant", "unknown"];
  for (const identityId of ordered) {
    const set = roles.get(identityId);
    if (!set) continue;
    for (const role of roleOrder) {
      if (set.has(role)) result.push({ identityId, paymentId: payment.id, role });
    }
  }
  return result;
}

export type MemberResponseState = "involved" | "unconfirmed" | "declined" | "unknown";

export function memberResponseState(
  payment: Payment,
  identityId: IdentityId,
): MemberResponseState {
  const involvement = involvementOf(payment, identityId);
  if (involvement.isPayer || involvement.isParticipant) {
    return involvement.needsConfirmation ? "unconfirmed" : "involved";
  }
  return payment.declinedBy.includes(identityId) ? "declined" : "unknown";
}

export interface Involvement {
  payer?: Payer;
  participant?: Participant;
  isPayer: boolean;
  isParticipant: boolean;
  needsConfirmation: boolean;
}

export function involvementOf(payment: Payment, identityId: IdentityId): Involvement {
  const payer = payment.payers.find((item) => item.identityId === identityId);
  const participant = payment.participants.find((item) => item.identityId === identityId);
  return {
    payer,
    participant,
    isPayer: payer !== undefined,
    isParticipant: participant !== undefined,
    needsConfirmation: Boolean(
      (payer && !payer.confirmed) || (participant && !participant.confirmed),
    ),
  };
}

export interface SettlementReport {
  balances: { identityId: IdentityId; balanceCents: number }[];
  transfers: { from: IdentityId; to: IdentityId; amountCents: number }[];
  includedPaymentIds: string[];
  excludedPaymentIds: string[];
  /** Nothing can be settled until every member has responded to every payment. */
  pending: PendingConfirmation[];
  canSettle: boolean;
  /** Transfers are only generated once the admin closes the activity. */
  closed: boolean;
  includedTotalCents: number;
}

export function buildSettlement(
  payments: Payment[],
  memberIds: IdentityId[] = [],
  closed = false,
): SettlementReport {
  const balances = new Map<IdentityId, number>();
  const included: string[] = [];
  const excluded: string[] = [];
  const pending: PendingConfirmation[] = [];

  const bump = (id: IdentityId, delta: number) => {
    balances.set(id, (balances.get(id) ?? 0) + delta);
  };

  let includedTotalCents = 0;

  for (const payment of payments) {
    if (!isPaymentValid(payment)) {
      excluded.push(payment.id);
      continue;
    }
    included.push(payment.id);
    includedTotalCents += payerTotal(payment);
    pending.push(...pendingConfirmationsFor(payment, memberIds));
    for (const payer of payment.payers) bump(payer.identityId, payer.amountCents);
    for (const [identityId, share] of computeShares(payment)) bump(identityId, -share);
  }

  const sorted = [...balances.entries()]
    .map(([identityId, balanceCents]) => ({ identityId, balanceCents }))
    .sort((a, b) => b.balanceCents - a.balanceCents);

  const canSettle = pending.length === 0;

  return {
    balances: sorted,
    transfers: closed && canSettle ? settleBalances(sorted) : [],
    includedPaymentIds: included,
    excludedPaymentIds: excluded,
    pending,
    canSettle,
    closed,
    includedTotalCents,
  };
}

/**
 * Debt simplification: repeatedly matches the largest debtor with the largest
 * creditor. Produces at most n-1 transfers, which clears the ledger.
 */
export function settleBalances(
  balances: { identityId: IdentityId; balanceCents: number }[],
): { from: IdentityId; to: IdentityId; amountCents: number }[] {
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => a.balanceCents - b.balanceCents);
  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.balanceCents - a.balanceCents);

  const transfers: { from: IdentityId; to: IdentityId; amountCents: number }[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(-debtor.balanceCents, creditor.balanceCents);

    if (amount > 0) {
      transfers.push({
        from: debtor.identityId,
        to: creditor.identityId,
        amountCents: amount,
      });
    }

    debtor.balanceCents += amount;
    creditor.balanceCents -= amount;
    if (debtor.balanceCents === 0) i++;
    if (creditor.balanceCents === 0) j++;
  }

  return transfers;
}
