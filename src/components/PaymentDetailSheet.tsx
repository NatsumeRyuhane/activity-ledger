import { useState } from "react";
import {
  centsToYuanInput,
  formatYuan,
  involvementOf,
  parseYuanToCents,
  payerTotal,
  shareTotal,
  type ActivityView,
  type Payment,
} from "@shared/domain";
import type { CommandInput } from "@shared/domain/commands";
import { PAYMENT_ISSUE_LABELS } from "@shared/domain";
import { IdentityBadge } from "@/components/IdentityBadge";
import { Badge, Button, Card, Input, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast-context";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { issuesOf, payerSummary, shareOf } from "@/lib/payment";
import type { RunCommand } from "@/hooks/useActivity";

export function PaymentDetailSheet({
  payment,
  view,
  me,
  busy,
  run,
  onClose,
  onEdit,
}: {
  payment: Payment;
  view: ActivityView;
  me: { id: string };
  busy?: boolean;
  run: RunCommand;
  onClose: () => void;
  onEdit: () => void;
}) {
  const toast = useToast();
  const [addPayerAmount, setAddPayerAmount] = useState<string | null>(null);
  const [joinShare, setJoinShare] = useState<string | null>(null);
  const [editMyShare, setEditMyShare] = useState<string | null>(null);

  const names = new Map(view.identities.map((identity) => [identity.id, identity]));
  const nameOf = (id: string) => names.get(id)?.name ?? "未知";
  const involvement = involvementOf(payment, me.id);
  const isManager = payment.createdBy === me.id;
  const issues = issuesOf(payment);
  const remainingPayer = Math.max(0, payment.amountCents - payerTotal(payment));
  const remainingShare = Math.max(0, payment.amountCents - shareTotal(payment));
  const myShare = shareOf(payment, me.id);

  async function exec(command: CommandInput, successMessage = "已更新") {
    try {
      await run(command);
      toast.show(successMessage, "success");
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "操作失败", "error");
    }
  }

  async function leavePayment() {
    try {
      if (involvement.isPayer) {
        await run({ type: "payer.remove", paymentId: payment.id, identityId: me.id });
      }
      if (involvement.isParticipant) {
        await run({ type: "participant.remove", paymentId: payment.id, identityId: me.id });
      }
      toast.show("已退出该付款", "success");
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "操作失败", "error");
    }
  }

  function confirmAddPayer() {
    const cents = parseYuanToCents(addPayerAmount ?? "");
    if (cents === null) {
      toast.show("金额格式不正确", "error");
      return;
    }
    setAddPayerAmount(null);
    void exec(
      { type: "payer.set", paymentId: payment.id, identityId: me.id, amountCents: cents },
      "已添加",
    );
  }

  function confirmJoin() {
    const cents = parseYuanToCents(joinShare ?? "");
    if (payment.splitMode === "custom" && cents === null) {
      toast.show("金额格式不正确", "error");
      return;
    }
    setJoinShare(null);
    void exec(
      {
        type: "participant.set",
        paymentId: payment.id,
        identityId: me.id,
        ...(payment.splitMode === "custom" ? { shareCents: cents ?? 0 } : {}),
      },
      "已加入",
    );
  }

  return (
    <Sheet open onClose={onClose} title="付款详情">
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3
              className={`text-lg font-semibold text-gray-900 ${payment.voided ? "line-through" : ""}`}
            >
              {payment.title}
            </h3>
            {payment.voided ? <Badge>已作废</Badge> : null}
            {!payment.voided && issues.length > 0 ? <Badge tone="amber">待完善</Badge> : null}
          </div>
          <p className="mt-1 text-3xl font-bold tracking-tight text-gray-900">
            {formatYuan(payment.amountCents)}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {payment.paidAt ? `${formatDateTime(payment.paidAt)} · ` : ""}
            {payerSummary(payment, nameOf)}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            分摊方式：{payment.splitMode === "equal" ? "均分" : "自定义"}
          </p>
          {payment.description ? (
            <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm leading-relaxed text-gray-600">
              {payment.description}
            </p>
          ) : null}
        </div>

        {!payment.voided && involvement.needsConfirmation ? (
          <Card className="border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">请确认你在该付款中的参与</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-700">
              {involvement.isPayer
                ? `你被登记为付款人，支付 ${formatYuan(involvement.payer?.amountCents ?? 0)}`
                : ""}
              {involvement.isPayer && involvement.isParticipant ? "；" : ""}
              {involvement.isParticipant && myShare !== undefined
                ? `你被登记为参与人，分摊 ${formatYuan(myShare)}`
                : ""}
              。确认之后，结算才能生成转账方案。
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={busy}
                onClick={() => void exec({ type: "entry.confirm", paymentId: payment.id }, "已确认")}
              >
                确认无误
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void leavePayment()}>
                都不是我
              </Button>
            </div>
          </Card>
        ) : null}

        {!payment.voided && issues.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm font-semibold text-amber-900">这笔付款还没有算好</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-amber-700">
              {issues.map((issue) => (
                <li key={issue}>{PAYMENT_ISSUE_LABELS[issue]}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-700">完善之前，这笔付款不会计入结算。</p>
          </Card>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">付款人</h4>
            {!payment.voided && !involvement.isPayer && addPayerAmount === null ? (
              <button
                type="button"
                className="text-sm font-medium text-teal-600"
                onClick={() => setAddPayerAmount(centsToYuanInput(remainingPayer))}
              >
                我也付了一部分
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            {payment.payers.map((payer) => (
              <div
                key={payer.identityId}
                className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2.5"
              >
                <IdentityBadge
                  identity={names.get(payer.identityId) ?? { name: "?", color: "#999" }}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                  {nameOf(payer.identityId)}
                  {payer.identityId === me.id ? (
                    <span className="ml-1 text-xs text-teal-600">我</span>
                  ) : null}
                </span>
                {!payer.confirmed ? <Badge tone="amber">待确认</Badge> : null}
                <span className="text-sm font-medium text-gray-900">
                  {formatYuan(payer.amountCents)}
                </span>
                {(isManager || payer.identityId === me.id) && !payment.voided ? (
                  <button
                    type="button"
                    aria-label="移除付款人"
                    disabled={busy}
                    onClick={() =>
                      void exec({
                        type: "payer.remove",
                        paymentId: payment.id,
                        identityId: payer.identityId,
                      })
                    }
                    className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                      <path
                        d="M5 5l10 10M15 5L5 15"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>
            ))}

            {addPayerAmount !== null ? (
              <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/50 px-3 py-2.5">
                <span className="flex-1 text-sm text-gray-700">我支付</span>
                <Input
                  value={addPayerAmount}
                  onChange={(event) => setAddPayerAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-24 text-right"
                />
                <Button className="shrink-0" disabled={busy} onClick={confirmAddPayer}>
                  确定
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">参与人</h4>
            {!payment.voided && !involvement.isParticipant && joinShare === null ? (
              <button
                type="button"
                className="text-sm font-medium text-teal-600"
                onClick={() =>
                  setJoinShare(payment.splitMode === "custom" ? centsToYuanInput(remainingShare) : "")
                }
              >
                我也参与
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            {payment.participants.map((participant) => {
              const share = shareOf(payment, participant.identityId);
              const isMe = participant.identityId === me.id;
              return (
                <div
                  key={participant.identityId}
                  className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2.5"
                >
                  <IdentityBadge
                    identity={names.get(participant.identityId) ?? { name: "?", color: "#999" }}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                    {nameOf(participant.identityId)}
                    {isMe ? <span className="ml-1 text-xs text-teal-600">我</span> : null}
                  </span>
                  {!participant.confirmed ? <Badge tone="amber">待确认</Badge> : null}
                  {share !== undefined ? (
                    <span className="text-sm font-medium text-gray-900">{formatYuan(share)}</span>
                  ) : null}
                  {isMe && payment.splitMode === "custom" && !payment.voided && editMyShare === null ? (
                    <button
                      type="button"
                      className="text-xs text-teal-600"
                      onClick={() => setEditMyShare(centsToYuanInput(participant.shareCents ?? 0))}
                    >
                      修改
                    </button>
                  ) : null}
                  {(isManager || isMe) && !payment.voided ? (
                    <button
                      type="button"
                      aria-label="移除参与人"
                      disabled={busy}
                      onClick={() =>
                        void exec({
                          type: "participant.remove",
                          paymentId: payment.id,
                          identityId: participant.identityId,
                        })
                      }
                      className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                    >
                      <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                        <path
                          d="M5 5l10 10M15 5L5 15"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              );
            })}

            {joinShare !== null ? (
              <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/50 px-3 py-2.5">
                <span className="flex-1 text-sm text-gray-700">
                  {payment.splitMode === "custom" ? "我分摊" : "加入参与人"}
                </span>
                {payment.splitMode === "custom" ? (
                  <Input
                    value={joinShare}
                    onChange={(event) => setJoinShare(event.target.value)}
                    inputMode="decimal"
                    className="w-24 text-right"
                  />
                ) : null}
                <Button className="shrink-0" disabled={busy} onClick={confirmJoin}>
                  确定
                </Button>
              </div>
            ) : null}

            {editMyShare !== null ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5">
                <span className="flex-1 text-sm text-gray-700">我分摊</span>
                <Input
                  value={editMyShare}
                  onChange={(event) => setEditMyShare(event.target.value)}
                  inputMode="decimal"
                  className="w-24 text-right"
                />
                <Button
                  variant="secondary"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => {
                    const cents = parseYuanToCents(editMyShare);
                    if (cents === null) {
                      toast.show("金额格式不正确", "error");
                      return;
                    }
                    setEditMyShare(null);
                    void exec(
                      {
                        type: "participant.set",
                        paymentId: payment.id,
                        identityId: me.id,
                        shareCents: cents,
                      },
                      "已修改",
                    );
                  }}
                >
                  保存
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="mt-6 border-t border-gray-100 pt-4">
        {!payment.voided && isManager ? (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onEdit} disabled={busy}>
              编辑付款
            </Button>
            <Button
              variant="secondary"
              className="flex-1 text-red-600"
              disabled={busy}
              onClick={() => {
                if (window.confirm("确定作废这笔付款吗？作废后不计入结算。")) {
                  void exec({ type: "payment.void", paymentId: payment.id }, "已作废");
                }
              }}
            >
              作废
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="w-full" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>
    </Sheet>
  );
}
