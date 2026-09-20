import { formatYuan } from "@shared/domain";
import { IdentityBadge } from "@/components/IdentityBadge";
import { Card, EmptyState } from "@/components/ui";
import { useToast } from "@/components/toast-context";
import { identityNameMap, settlementBlockers } from "@/lib/payment";
import type { ActivityController } from "@/hooks/useActivity";

export function SettlementTab({ controller }: { controller: ActivityController }) {
  const { view } = controller;
  const toast = useToast();
  if (!view) return null;

  const { settlement, payments, identities } = view;
  const names = identityNameMap(identities);
  const nameOf = (id: string) => names.get(id) ?? "未知";
  const identityOf = (id: string) => identities.find((identity) => identity.id === id);
  const titles = new Map(payments.map((payment) => [payment.id, payment.title]));
  const blockers = settlementBlockers(
    settlement.pending,
    (id) => titles.get(id) ?? "付款",
    nameOf,
  );

  const activePayments = payments.filter((payment) => !payment.voided);
  const nothingToDoSettle = settlement.includedTotalCents === 0 && blockers.length === 0;

  async function copyPlan() {
    const text = settlement.transfers
      .map((transfer) => `${nameOf(transfer.from)} → ${nameOf(transfer.to)} ${formatYuan(transfer.amountCents)}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.show("转账方案已复制", "success");
    } catch {
      toast.show("复制失败，请手动截图", "error");
    }
  }

  return (
    <div className="space-y-6 pb-24">
      {!settlement.canSettle ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">暂时无法计算转账方案</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-800">
            {blockers.map((blocker) => (
              <li key={blocker.paymentId}>
                <p className="font-medium">付款「{blocker.paymentTitle}」</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {blocker.lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">
            每个成员都必须在这笔付款里表态——参与就确认金额，没参与就明确说「我没参与」。
          </p>
        </Card>
      ) : null}

      {settlement.excludedPaymentIds.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-medium text-amber-900">
            有 {settlement.excludedPaymentIds.length} 笔付款待完善，未计入结算
          </p>
          <p className="mt-1 text-xs text-amber-700">
            在「账目」里补齐付款人金额与分摊金额后，会自动计入。
          </p>
        </Card>
      ) : null}

      {activePayments.length === 0 ? (
        <EmptyState title="还没有账目" description="先去「账目」记一笔吧" />
      ) : (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>已计入结算的付款</span>
              <span className="font-medium text-gray-900">{settlement.includedPaymentIds.length} 笔</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-sm text-gray-500">
              <span>结算总额</span>
              <span className="font-mono font-semibold tabular-nums text-gray-900">
                {formatYuan(settlement.includedTotalCents)}
              </span>
            </div>
          </Card>

          <section>
            <h2 className="mb-2 px-1 text-sm font-medium text-gray-500">每人余额</h2>
            <Card className="divide-y divide-gray-100">
              {settlement.balances.map((balance) => (
                <div key={balance.identityId} className="flex items-center gap-3 px-4 py-3">
                  {identityOf(balance.identityId) ? (
                    <IdentityBadge identity={identityOf(balance.identityId)!} size="sm" />
                  ) : null}
                  <span className="flex-1 truncate text-sm text-gray-800">
                    {nameOf(balance.identityId)}
                  </span>
                  {balance.balanceCents > 0 ? (
                    <span className="font-mono text-sm font-semibold tabular-nums text-emerald-600">
                      应收 {formatYuan(balance.balanceCents)}
                    </span>
                  ) : balance.balanceCents < 0 ? (
                    <span className="font-mono text-sm font-semibold tabular-nums text-red-600">
                      应付 {formatYuan(-balance.balanceCents)}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">已结清</span>
                  )}
                </div>
              ))}
            </Card>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-medium text-gray-500">最少转账方案</h2>
              {settlement.canSettle && settlement.transfers.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void copyPlan()}
                  className="text-sm font-medium text-teal-600"
                >
                  复制方案
                </button>
              ) : null}
            </div>

            {!settlement.canSettle ? (
              <Card className="p-4 text-sm text-gray-400">等待确认后生成</Card>
            ) : nothingToDoSettle || settlement.transfers.length === 0 ? (
              <Card className="p-4 text-sm text-gray-500">账目已平，不需要转账 🎉</Card>
            ) : (
              <Card className="divide-y divide-gray-100">
                {settlement.transfers.map((transfer, index) => (
                  <div key={`${transfer.from}-${transfer.to}-${index}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-gray-800">
                      <span className="truncate font-medium">{nameOf(transfer.from)}</span>
                      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-gray-400">
                        <path
                          d="M4 10h12m-4-4 4 4-4 4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="truncate font-medium">{nameOf(transfer.to)}</span>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-gray-900">
                      {formatYuan(transfer.amountCents)}
                    </span>
                  </div>
                ))}
                <p className="px-4 py-2.5 text-xs text-gray-400">
                  共 {settlement.transfers.length} 笔转账即可结清全部账目
                </p>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
