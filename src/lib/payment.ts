import {
  computeShares,
  formatYuan,
  memberResponseState,
  payerTotal,
  pendingConfirmationsFor,
  validatePayment,
  type Identity,
  type Payment,
  type PaymentIssue,
  type PendingConfirmation,
  type PendingRole,
} from "@shared/domain";

export function isIncomplete(payment: Payment): boolean {
  return !payment.voided && validatePayment(payment).length > 0;
}

export function issuesOf(payment: Payment): PaymentIssue[] {
  return validatePayment(payment);
}

export function payerSummary(payment: Payment, nameOf: (id: string) => string): string {
  if (payment.payers.length === 0) return "暂无付款人";
  if (payment.payers.length === 1) {
    const [payer] = payment.payers;
    return `${nameOf(payer.identityId)} 付款 ${formatYuan(payer.amountCents)}`;
  }
  return `${payment.payers.length} 人共同付款 ${formatYuan(payerTotal(payment))}`;
}

export function totalOf(payment: Payment): number {
  return payerTotal(payment);
}

export function shareOf(payment: Payment, identityId: string): number | undefined {
  if (payment.splitMode === "custom") {
    return payment.participants.find((p) => p.identityId === identityId)?.shareCents;
  }
  return computeShares(payment).get(identityId);
}

/** Members that still owe an answer (confirm participation, or decline it). */
export function pendingPeopleCount(payment: Payment, memberIds: string[]): number {
  return new Set(
    pendingConfirmationsFor(payment, memberIds).map((entry) => entry.identityId),
  ).size;
}

export function myResponseState(
  payment: Payment,
  identityId: string,
): ReturnType<typeof memberResponseState> {
  return memberResponseState(payment, identityId);
}

export function needsMyResponse(payment: Payment, identityId: string): boolean {
  const state = memberResponseState(payment, identityId);
  return state === "unconfirmed" || state === "unknown";
}

export interface Blocker {
  paymentId: string;
  paymentTitle: string;
  lines: string[];
}

/** Groups pending confirmations by payment into readable sentences. */
export function settlementBlockers(
  pending: PendingConfirmation[],
  paymentTitleOf: (id: string) => string,
  nameOf: (id: string) => string,
): Blocker[] {
  const grouped = new Map<string, Map<string, Set<PendingRole>>>();
  for (const entry of pending) {
    const byIdentity = grouped.get(entry.paymentId) ?? new Map<string, Set<PendingRole>>();
    const roles = byIdentity.get(entry.identityId) ?? new Set<PendingRole>();
    roles.add(entry.role);
    byIdentity.set(entry.identityId, roles);
    grouped.set(entry.paymentId, byIdentity);
  }

  return [...grouped.entries()].map(([paymentId, byIdentity]) => ({
    paymentId,
    paymentTitle: paymentTitleOf(paymentId),
    lines: [...byIdentity.entries()].map(([identityId, roles]) => {
      if (roles.has("unknown")) return `「${nameOf(identityId)}」尚未确认是否参与`;
      const parts: string[] = [];
      if (roles.has("payer")) parts.push("付款金额");
      if (roles.has("participant")) parts.push("分摊金额");
      return `「${nameOf(identityId)}」的${parts.join("和")}尚未确认`;
    }),
  }));
}

export function identityNameMap(identities: Identity[]): Map<string, string> {
  return new Map(identities.map((identity) => [identity.id, identity.name]));
}
