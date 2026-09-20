import type { IdentityId, Participant, Payer, Payment } from "./types";
import { sumCents } from "./money";

export type PaymentIssue =
  | "no-payers"
  | "payer-sum-mismatch"
  | "no-participants"
  | "share-sum-mismatch";

export const PAYMENT_ISSUE_LABELS: Record<PaymentIssue, string> = {
  "no-payers": "还没有登记付款人",
  "payer-sum-mismatch": "付款人金额合计与总额不符",
  "no-participants": "还没有参与人",
  "share-sum-mismatch": "分摊金额合计与总额不符",
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
  else if (payerTotal(payment) !== payment.amountCents) issues.push("payer-sum-mismatch");

  if (payment.participants.length === 0) issues.push("no-participants");
  else if (payment.splitMode === "custom" && shareTotal(payment) !== payment.amountCents) {
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

export interface UnconfirmedEntry {
  identityId: IdentityId;
  paymentId: Payment["id"];
  role: "payer" | "participant";
}

export function unconfirmedEntries(payment: Payment): UnconfirmedEntry[] {
  if (payment.voided) return [];
  const result: UnconfirmedEntry[] = [];
  for (const payer of payment.payers) {
    if (!payer.confirmed) {
      result.push({ identityId: payer.identityId, paymentId: payment.id, role: "payer" });
    }
  }
  for (const participant of payment.participants) {
    if (!participant.confirmed) {
      result.push({
        identityId: participant.identityId,
        paymentId: payment.id,
        role: "participant",
      });
    }
  }
  return result;
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
  unconfirmed: UnconfirmedEntry[];
  canSettle: boolean;
  includedTotalCents: number;
}

export function buildSettlement(payments: Payment[]): SettlementReport {
  const balances = new Map<IdentityId, number>();
  const included: string[] = [];
  const excluded: string[] = [];
  const unconfirmed: UnconfirmedEntry[] = [];

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
    includedTotalCents += payment.amountCents;
    unconfirmed.push(...unconfirmedEntries(payment));
    for (const payer of payment.payers) bump(payer.identityId, payer.amountCents);
    for (const [identityId, share] of computeShares(payment)) bump(identityId, -share);
  }

  const sorted = [...balances.entries()]
    .map(([identityId, balanceCents]) => ({ identityId, balanceCents }))
    .sort((a, b) => b.balanceCents - a.balanceCents);

  const canSettle = unconfirmed.length === 0;

  return {
    balances: sorted,
    transfers: canSettle ? settleBalances(sorted) : [],
    includedPaymentIds: included,
    excludedPaymentIds: excluded,
    unconfirmed,
    canSettle,
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
