import { useState } from "react";
import { formatYuan } from "@shared/domain";
import { UserPill, type AvatarIdentity } from "@/components/IdentityBadge";
import { Badge, Button, Card, EmptyState, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast-context";
import { ApiError } from "@/lib/api";
import { identityNameMap, settlementBlockers } from "@/lib/payment";
import type { ActivityController } from "@/hooks/useActivity";

export function SettlementTab({
  controller,
  adminPassword,
}: {
  controller: ActivityController;
  adminPassword: string | null;
}) {
  const { view, me, run, busy } = controller;
  const toast = useToast();
  const [confirming, setConfirming] = useState<"normal" | "forced" | null>(null);

  if (!view) return null;

  const { settlement, payments, identities, activity } = view;
  const names = identityNameMap(identities);
  const nameOf = (id: string) => names.get(id) ?? "未知";
  const identityOf = (id: string): AvatarIdentity =>
    identities.find((identity) => identity.id === id) ?? { name: "未知", color: "#9ca3af" };
  const titles = new Map(payments.map((payment) => [payment.id, payment.title]));
  const blockers = settlementBlockers(
    settlement.pending,
    (id) => titles.get(id) ?? "付款",
    nameOf,
  );

  const closed = activity.closedAt !== undefined;
  const isCreator = me?.id === activity.creatorIdentityId;
  const unlocked = isCreator && adminPassword !== null;
  const activePayments = payments.filter((payment) => !payment.voided);
  const nothingToDoSettle =
    settlement.includedTotalCents === 0 && settlement.pending.length === 0;

  async function closeActivity(forced: boolean) {
    try {
      await run({ type: "activity.close", forced }, { adminPassword: adminPassword ?? undefined });
      toast.show(forced ? "活动已强制关闭" : "活动已关闭", "success");
      setConfirming(null);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "关闭失败，请稍后再试", "error");
    }
  }

  async function copyPlan() {
    const text = settlement.transfers
      .map(
        (transfer) =>
          `${nameOf(transfer.from)} → ${nameOf(transfer.to)} ${formatYuan(transfer.amountCents)}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.show("转账方案已复制", "success");
    } catch {
      toast.show("复制失败，请手动截图", "error");
    }
  }

  if (activePayments.length === 0) {
    return (
      <div className="pb-24">
        <EmptyState title="还没有账目" description="先去「账目」记一笔吧" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {closed && activity.closedForced ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">活动已强制关闭</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            关闭时仍有成员没有回应，他们的未确认登记已被移除，并视为「未参与」。
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

      <Card className="p-4">
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>已计入结算的付款</span>
          <span className="font-medium text-gray-900">
            {settlement.includedPaymentIds.length} 笔
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-sm text-gray-500">
          <span>结算总额</span>
          <span className="font-mono font-semibold tabular-nums text-gray-900">
            {formatYuan(settlement.includedTotalCents)}
          </span>
        </div>
        {closed ? (
          <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
            <Badge tone="green">活动已关闭</Badge>
            <span className="text-xs text-gray-400">
              {activity.closedAt ? new Date(activity.closedAt).toLocaleString("zh-CN") : ""}
            </span>
          </div>
        ) : null}
      </Card>

      <section>
        <h2 className="mb-2 px-1 text-sm font-medium text-gray-500">每人余额</h2>
        <Card className="divide-y divide-gray-100">
          {settlement.balances.map((balance) => (
            <div key={balance.identityId} className="flex items-center gap-3 px-3 py-2.5">
              <UserPill
                identity={identityOf(balance.identityId)}
                size="sm"
                className="max-w-[60%]"
              />
              <span className="ml-auto shrink-0">
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
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-medium text-gray-500">最少转账方案</h2>
          {closed && settlement.transfers.length > 0 ? (
            <button
              type="button"
              onClick={() => void copyPlan()}
              className="text-sm font-medium text-teal-600"
            >
              复制方案
            </button>
          ) : null}
        </div>

        {!closed ? (
          <Card className="border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              转账方案需要管理员关闭活动后生成
            </p>

            {settlement.pending.length > 0 ? (
              <>
                <p className="mt-2 text-xs font-medium text-amber-800">还没有确认：</p>
                <ul className="mt-1 space-y-1.5 text-xs leading-relaxed text-amber-800">
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
                <p className="mt-2 text-xs leading-relaxed text-amber-700">
                  所有人都确认后即可正常关闭；管理员也可以强制关闭，未确认的成员将按「未参与」处理。
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                所有成员都已回应，管理员关闭活动后这里会生成最少转账方案。
              </p>
            )}

            {unlocked ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={busy || settlement.pending.length > 0}
                  onClick={() => setConfirming("normal")}
                >
                  确认关闭活动
                </Button>
                {settlement.pending.length > 0 ? (
                  <Button
                    variant="secondary"
                    className="text-red-600"
                    disabled={busy}
                    onClick={() => setConfirming("forced")}
                  >
                    强制关闭
                  </Button>
                ) : null}
              </div>
            ) : isCreator ? (
              <p className="mt-3 text-xs text-amber-700">
                请在「管理」中解锁管理员模式后关闭活动。
              </p>
            ) : null}
          </Card>
        ) : nothingToDoSettle || settlement.transfers.length === 0 ? (
          <Card className="p-4 text-sm text-gray-500">账目已平，不需要转账 🎉</Card>
        ) : (
          <Card className="divide-y divide-gray-100">
            {settlement.transfers.map((transfer, index) => (
              <div
                key={`${transfer.from}-${transfer.to}-${index}`}
                className="flex items-center gap-2 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <UserPill identity={identityOf(transfer.from)} size="sm" className="max-w-[45%]" />
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-4 w-4 shrink-0 text-gray-400"
                  >
                    <path
                      d="M4 10h12m-4-4 4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <UserPill identity={identityOf(transfer.to)} size="sm" className="max-w-[45%]" />
                </div>
                <span className="ml-auto shrink-0 font-mono text-sm font-semibold tabular-nums text-gray-900">
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

      {confirming ? (
        <Sheet
          open
          onClose={() => setConfirming(null)}
          title={confirming === "forced" ? "强制关闭活动" : "确认关闭活动"}
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirming(null)}>
                取消
              </Button>
              <Button
                className={`flex-1 ${confirming === "forced" ? "bg-red-600 hover:bg-red-700 active:bg-red-800" : ""}`}
                disabled={busy}
                onClick={() => void closeActivity(confirming === "forced")}
              >
                {busy ? "关闭中…" : confirming === "forced" ? "确认强制关闭" : "确认关闭"}
              </Button>
            </div>
          }
        >
          {confirming === "forced" ? (
            <div className="space-y-3 text-sm leading-relaxed text-gray-600">
              <p>
                还有 <span className="font-semibold text-red-600">{settlement.pending.length}</span>{" "}
                项没有确认。强制关闭后：
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {blockers.map((blocker) => (
                  <li key={blocker.paymentId}>
                    付款「{blocker.paymentTitle}」：
                    {blocker.lines.map((line, index) => (
                      <span key={index}>
                        {index > 0 ? "；" : ""}
                        {line}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-700">
                未确认的付款/参与登记会被移除，相关成员按「未参与」处理，然后生成转账方案。
              </p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-gray-600">
              关闭后将锁定账目，并生成最少转账方案。如需修改，可以在「记录」中回滚关闭操作。
            </p>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
