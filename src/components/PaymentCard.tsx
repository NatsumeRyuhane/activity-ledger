import { formatYuan, payerTotal, type Payment } from "@shared/domain";
import { IdentityBadge } from "@/components/IdentityBadge";
import { Badge, Card } from "@/components/ui";
import { payerSummary, unconfirmedCount, isIncomplete } from "@/lib/payment";
import { formatDateTime } from "@/lib/format";
import type { ActivityView } from "@shared/domain";

export function PaymentCard({
  payment,
  view,
  onClick,
}: {
  payment: Payment;
  view: ActivityView;
  onClick: () => void;
}) {
  const names = new Map(view.identities.map((identity) => [identity.id, identity]));
  const nameOf = (id: string) => names.get(id)?.name ?? "未知";
  const pending = unconfirmedCount(payment);
  const incomplete = isIncomplete(payment);
  const visibleParticipants = payment.participants.slice(0, 4);

  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <Card
        className={`p-4 transition-shadow active:bg-gray-50 ${payment.voided ? "opacity-60" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3
                className={`truncate text-[15px] font-semibold text-gray-900 ${
                  payment.voided ? "line-through" : ""
                }`}
              >
                {payment.title}
              </h3>
              {payment.voided ? <Badge>已作废</Badge> : null}
              {!payment.voided && incomplete ? <Badge tone="amber">待完善</Badge> : null}
              {!payment.voided && pending > 0 ? (
                <Badge tone="amber">{pending} 项待确认</Badge>
              ) : null}
            </div>

            <p className="mt-0.5 text-xs text-gray-400">
              {payment.paidAt ? formatDateTime(payment.paidAt) : ""}
              {payment.paidAt ? " · " : ""}
              {payerSummary(payment, nameOf)}
            </p>

            {visibleParticipants.length > 0 ? (
              <div className="mt-2 flex items-center gap-1.5">
                <div className="flex -space-x-1.5">
                  {visibleParticipants.map((participant) => {
                    const identity = names.get(participant.identityId);
                    if (!identity) return null;
                    return (
                      <span key={participant.identityId} className="rounded-full ring-2 ring-white">
                        <IdentityBadge identity={identity} size="sm" />
                      </span>
                    );
                  })}
                </div>
                <span className="text-xs text-gray-400">
                  {payment.participants.length} 人参与
                  {payment.participants.length > visibleParticipants.length
                    ? ` · 等 ${payment.participants.length} 人`
                    : ""}
                </span>
              </div>
            ) : null}
          </div>

          <p className="shrink-0 text-right font-mono text-lg font-semibold tabular-nums text-gray-900">
            {formatYuan(payerTotal(payment))}
          </p>
        </div>
      </Card>
    </button>
  );
}
