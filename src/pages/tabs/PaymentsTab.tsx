import { useMemo, useState } from "react";
import type { Payment } from "@shared/domain";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { PaymentCard } from "@/components/PaymentCard";
import { PaymentDetailSheet } from "@/components/PaymentDetailSheet";
import { PaymentFormSheet, type PaymentFormValue } from "@/components/PaymentFormSheet";
import { Card, EmptyState } from "@/components/ui";
import { needsMyResponse } from "@/lib/payment";
import { parseLocalDate } from "@/lib/format";
import type { ActivityController } from "@/hooks/useActivity";

export function PaymentsTab({ controller }: { controller: ActivityController }) {
  const { view, me, run, busy } = controller;
  const toast = useToast();
  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; paymentId: string } | null
  >(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const payments = useMemo(() => {
    if (!view) return [];
    const timeOf = (payment: Payment) =>
      payment.paidAt
        ? (parseLocalDate(payment.paidAt)?.getTime() ?? payment.createdAt)
        : payment.createdAt;
    return [...view.payments].sort((a, b) => timeOf(b) - timeOf(a));
  }, [view]);

  if (!view || !me) return null;

  const closed = view.activity.closedAt !== undefined;
  const myPending = view.payments.filter(
    (payment) => !payment.voided && !closed && needsMyResponse(payment, me.id),
  );
  const incompleteCount = view.settlement.excludedPaymentIds.length;
  const detailPayment = detailId ? view.payments.find((p) => p.id === detailId) : undefined;
  const editingPayment =
    formState?.mode === "edit"
      ? view.payments.find((p) => p.id === formState.paymentId) ?? null
      : null;

  async function savePayment(value: PaymentFormValue) {
    if (!formState) return;
    try {
      if (formState.mode === "create") {
        await run({ type: "payment.create", ...value });
        toast.show("付款已创建", "success");
      } else {
        const payment = view!.payments.find((item) => item.id === formState.paymentId);
        if (!payment) throw new Error("missing payment");

        // One batch command: the server validates the whole edit and appends
        // every event in a single transaction.
        await run({
          type: "payment.edit",
          paymentId: payment.id,
          title: value.title,
          paidAt: value.paidAt,
          description: value.description,
          splitMode: value.splitMode,
          payers: value.payers,
          participants: value.participants,
        });
        toast.show("已保存", "success");
      }
      setFormState(null);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "保存失败，请稍后再试", "error");
    }
  }

  return (
    <div className="space-y-3 pb-24">
      {closed ? (
        <Card className="p-4">
          <p className="text-sm font-medium text-gray-700">活动已关闭</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            账目已锁定，不能再修改或补充。如需调整，请让管理员在「记录」中回滚关闭操作。
          </p>
        </Card>
      ) : null}

      {myPending.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            有 {myPending.length} 笔付款等待你回应
          </p>
          <div className="mt-2 space-y-1.5">
            {myPending.map((payment) => (
              <button
                key={payment.id}
                type="button"
                onClick={() => setDetailId(payment.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-left"
              >
                <span className="truncate text-sm text-gray-800">{payment.title}</span>
                <span className="shrink-0 text-xs font-medium text-teal-600">去回应 →</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-700">
            参与的人确认金额，没参与的人明确说「我没参与」，全部回应后才会生成转账方案。
          </p>
        </Card>
      ) : null}

      {incompleteCount > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-medium text-amber-900">
            有 {incompleteCount} 笔付款待完善，暂未计入结算
          </p>
          <p className="mt-1 text-xs text-amber-700">
            通常是付款金额合计或分摊金额合计与总额不一致。
          </p>
        </Card>
      ) : null}

      {payments.length === 0 ? (
        <EmptyState
          title="还没有账目"
          description="点右下角「记一笔」开始记账，或把链接分享给朋友"
        />
      ) : (
        payments.map((payment) => (
          <PaymentCard
            key={payment.id}
            payment={payment}
            view={view}
            onClick={() => setDetailId(payment.id)}
          />
        ))
      )}

      {!closed ? (
        <button
          type="button"
          onClick={() => setFormState({ mode: "create" })}
          className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex h-13 items-center gap-1.5 rounded-full bg-teal-600 py-3.5 pr-5 pl-4 text-[15px] font-semibold text-white shadow-lg shadow-teal-600/25 active:bg-teal-700"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          记一笔
        </button>
      ) : null}

      {detailPayment ? (
        <PaymentDetailSheet
          payment={detailPayment}
          view={view}
          me={me}
          busy={busy}
          run={run}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setFormState({ mode: "edit", paymentId: detailPayment.id });
          }}
        />
      ) : null}

      {formState ? (
        <PaymentFormSheet
          key={formState.mode === "edit" ? formState.paymentId : "create"}
          view={view}
          me={me}
          payment={editingPayment}
          busy={busy}
          onClose={() => setFormState(null)}
          onSubmit={(value) => void savePayment(value)}
        />
      ) : null}
    </div>
  );
}
