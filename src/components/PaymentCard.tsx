import { formatYuan, payerTotal, type ActivityView, type Payment } from "@shared/domain";
import { UserPill, type AvatarIdentity } from "@/components/IdentityBadge";
import { Badge, Card } from "@/components/ui";
import { isIncomplete, pendingPeopleCount } from "@/lib/payment";
import { formatDateTime } from "@/lib/format";

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
  const identityOf = (id: string): AvatarIdentity =>
    names.get(id) ?? { name: "未知", color: "#9ca3af" };
  const pending = pendingPeopleCount(
    payment,
    view.identities.map((identity) => identity.id),
  );
  const incomplete = isIncomplete(payment);
  const payers = payment.payers.slice(0, 2);
  const participants = payment.participants.slice(0, 3);

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
                <Badge tone="amber">{pending} 人待回应</Badge>
              ) : null}
            </div>

            {payment.paidAt ? (
              <p className="mt-0.5 text-xs text-gray-400">{formatDateTime(payment.paidAt)}</p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-400">付款人</span>
              {payers.map((payer) => (
                <UserPill key={payer.identityId} identity={identityOf(payer.identityId)} size="sm" />
              ))}
              {payment.payers.length > payers.length ? (
                <span className="text-xs text-gray-400">+{payment.payers.length - payers.length}</span>
              ) : null}
            </div>

            {payment.participants.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-400">参与</span>
                {participants.map((participant) => (
                  <UserPill
                    key={participant.identityId}
                    identity={identityOf(participant.identityId)}
                    size="sm"
                    muted={!participant.confirmed}
                  />
                ))}
                {payment.participants.length > participants.length ? (
                  <span className="text-xs text-gray-400">
                    +{payment.participants.length - participants.length}
                  </span>
                ) : null}
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
