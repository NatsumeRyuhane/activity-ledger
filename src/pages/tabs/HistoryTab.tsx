import { useState } from "react";
import { describeEvent, type LedgerEvent } from "@shared/domain";
import { UserPill, type AvatarIdentity } from "@/components/IdentityBadge";
import { Badge, Button, Card, EmptyState, Field, Input, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast-context";
import { ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { ActivityController } from "@/hooks/useActivity";

export function HistoryTab({
  controller,
  adminPassword,
  onUnlocked,
}: {
  controller: ActivityController;
  adminPassword: string | null;
  onUnlocked: (password: string) => void;
}) {
  const { view, me, run, busy } = controller;
  const toast = useToast();
  const [target, setTarget] = useState<LedgerEvent | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");

  if (!view || !me) return null;

  const activity = view.activity;
  const isCreator = me.id === activity.creatorIdentityId;
  const canRollback = isCreator && activity.hasPassword;
  const paymentTitles = new Map(view.payments.map((payment) => [payment.id, payment.title]));
  const identityOf = (id: string): AvatarIdentity =>
    view.identities.find((identity) => identity.id === id) ?? { name: "未知", color: "#9ca3af" };
  const events = [...view.events].sort((a, b) => b.seq - a.seq);
  const effectiveSeqs = view.events
    .filter((event) => !event.voided && event.type !== "rollback")
    .map((event) => event.seq);

  const removableCount = target
    ? effectiveSeqs.filter((seq) => seq > target.seq).length
    : 0;

  async function doRollback() {
    if (!target) return;
    const effectivePassword = adminPassword ?? password;
    if (!effectivePassword) {
      toast.show("请输入管理员密码", "error");
      return;
    }
    try {
      await run(
        {
          type: "rollback",
          targetSeq: target.seq,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        { adminPassword: effectivePassword },
      );
      if (!adminPassword) onUnlocked(effectivePassword);
      toast.show("已回滚", "success");
      setTarget(null);
      setReason("");
      setPassword("");
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "回滚失败", "error");
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Card className="p-4">
        <p className="text-sm leading-relaxed text-gray-500">
          这里记录了活动里的每一次变更。记录不会被删除，回滚只是让它之后的变更失效，并同样留痕。
        </p>
        {isCreator && !activity.hasPassword ? (
          <p className="mt-2 text-xs text-amber-600">
            在「管理」里设置管理员密码后，即可回滚到任意历史位置。
          </p>
        ) : null}
      </Card>

      {events.length === 0 ? (
        <EmptyState title="还没有记录" />
      ) : (
        <Card className="px-4 py-2">
          {events.map((event, index) => {
            const description = describeEvent(event, { paymentTitles });
            const rollbackAble = canRollback && !event.voided && event.type !== "rollback";
            return (
              <div
                key={event.seq}
                className={`flex gap-3 ${index < events.length - 1 ? "border-b border-gray-100" : ""} ${
                  event.voided ? "opacity-50" : ""
                }`}
              >
                <div className="flex flex-col items-center pt-4">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      event.type === "rollback"
                        ? "bg-amber-400"
                        : event.voided
                          ? "bg-gray-300"
                          : "bg-teal-500"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1 py-3.5">
                  <div
                    className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${
                      event.voided ? "line-through" : ""
                    }`}
                  >
                    {description.actorIdentityId ? (
                      <UserPill identity={identityOf(description.actorIdentityId)} size="sm" />
                    ) : null}
                    <p className="min-w-0 text-sm leading-relaxed text-gray-700">
                      {description.parts.map((part, partIndex) =>
                        part.kind === "text" ? (
                          <span key={partIndex}>{part.value}</span>
                        ) : (
                          <UserPill
                            key={partIndex}
                            identity={identityOf(part.identityId)}
                            size="sm"
                            className="mx-0.5 align-middle"
                          />
                        ),
                      )}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {formatRelative(event.createdAt)}
                    </span>
                    {event.voided ? <Badge>已撤销</Badge> : null}
                    <span className="text-xs text-gray-300">#{event.seq}</span>
                    {rollbackAble ? (
                      <button
                        type="button"
                        onClick={() => setTarget(event)}
                        className="ml-auto text-xs font-medium text-teal-600"
                      >
                        回滚到此处
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {target ? (
        <Sheet
          open
          onClose={() => setTarget(null)}
          title="确认回滚"
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setTarget(null)}>
                取消
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 active:bg-red-800"
                disabled={busy}
                onClick={() => void doRollback()}
              >
                {busy ? "回滚中…" : "确认回滚"}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-gray-600">
            将回滚到 #{target.seq} 时的状态，撤销此后的{" "}
            <span className="font-semibold text-red-600">{removableCount}</span> 条有效变更。
            已被撤销过的记录不会恢复。
          </p>

          <div className="mt-4 space-y-3">
            {!adminPassword ? (
              <Field label="管理员密码">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="用于验证管理员身份"
                  maxLength={128}
                />
              </Field>
            ) : null}
            <Field label="回滚原因" hint="选填">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：金额记错了"
                maxLength={100}
              />
            </Field>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
