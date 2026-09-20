import {
  computeShares,
  formatYuan,
  involvementOf,
  payerTotal,
  validatePayment,
  type Identity,
  type Payment,
  type PaymentIssue,
  type UnconfirmedEntry,
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

export function participantCount(payment: Payment): number {
  return payment.participants.length;
}

export function shareOf(payment: Payment, identityId: string): number | undefined {
  if (payment.splitMode === "custom") {
    return payment.participants.find((p) => p.identityId === identityId)?.shareCents;
  }
  return computeShares(payment).get(identityId);
}

export function unconfirmedCount(payment: Payment): number {
  if (payment.voided) return 0;
  return (
    payment.payers.filter((p) => !p.confirmed).length +
    payment.participants.filter((p) => !p.confirmed).length
  );
}

export interface Blocker {
  paymentId: string;
  paymentTitle: string;
  names: string;
  roles: string;
}

/** Groups unconfirmed entries by (payment, person) into readable blockers. */
export function settlementBlockers(
  unconfirmed: UnconfirmedEntry[],
  paymentTitleOf: (id: string) => string,
  nameOf: (id: string) => string,
): Blocker[] {
  const grouped = new Map<string, { paymentId: string; identityIds: Set<string>; roles: Set<string> }>();
  for (const entry of unconfirmed) {
    const key = entry.paymentId;
    const bucket = grouped.get(key) ?? {
      paymentId: entry.paymentId,
      identityIds: new Set<string>(),
      roles: new Set<string>(),
    };
    bucket.identityIds.add(entry.identityId);
    bucket.roles.add(entry.role === "payer" ? "付款金额" : "分摊金额");
    grouped.set(key, bucket);
  }

  return [...grouped.values()].map((bucket) => ({
    paymentId: bucket.paymentId,
    paymentTitle: paymentTitleOf(bucket.paymentId),
    names: [...bucket.identityIds].map(nameOf).join("、"),
    roles: [...bucket.roles].join("和"),
  }));
}

export function identityNameMap(identities: Identity[]): Map<string, string> {
  return new Map(identities.map((identity) => [identity.id, identity.name]));
}

export function needsMyConfirmation(payment: Payment, identityId: string): boolean {
  return involvementOf(payment, identityId).needsConfirmation;
}
