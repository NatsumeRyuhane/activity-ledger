import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { Badge, Button, Card, Field, Input, Spinner, Textarea } from "@/components/ui";
import type { ActivityController } from "@/hooks/useActivity";

export function AdminTab({
  controller,
  adminPassword,
  verifyPassword,
  onUnlocked,
  onGoToSettlement,
}: {
  controller: ActivityController;
  adminPassword: string | null;
  verifyPassword: (password: string) => Promise<void>;
  onUnlocked: (password: string) => void;
  onGoToSettlement: () => void;
}) {
  const { view, me, run, busy, reload } = controller;
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  if (!view || !me) return null;

  const activity = view.activity;
  const isCreator = me.id === activity.creatorIdentityId;
  const creator = view.identities.find((identity) => identity.id === activity.creatorIdentityId);
  const unlocked = isCreator && adminPassword !== null;

  async function handleUnlock() {
    if (!password) {
      toast.show("请输入管理员密码", "error");
      return;
    }
    try {
      await verifyPassword(password);
      onUnlocked(password);
      setPassword("");
      toast.show("管理员模式已解锁", "success");
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "解锁失败", "error");
    }
  }

  async function handleSetPassword() {
    if (newPassword.length < 4) {
      toast.show("密码至少 4 位", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.show("两次输入的密码不一致", "error");
      return;
    }
    try {
      await run(
        { type: "admin.setPassword", newPassword },
        { adminPassword: adminPassword ?? undefined },
      );
      onUnlocked(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast.show("管理员密码已设置", "success");
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "设置失败", "error");
    }
  }

  async function handleSaveSettings() {
    const nextName = name ?? activity.name;
    const nextDescription =
      description === null ? (activity.description ?? null) : description.trim() || null;
    try {
      await run(
        {
          type: "settings.update",
          name: nextName.trim() || activity.name,
          description: nextDescription,
        },
        { adminPassword: adminPassword ?? undefined },
      );
      setName(null);
      setDescription(null);
      toast.show("活动信息已更新", "success");
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "保存失败", "error");
    }
  }

  if (!isCreator) {
    return (
      <div className="space-y-4 pb-24">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900">管理员</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            当前身份是「{me.name}」，只有活动创建者
            {creator ? `「${creator.name}」` : ""}
            可以管理回滚等高级功能。
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            如果你是创建者，请在右上角切换到自己的身份。
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">管理员模式</h2>
          {activity.hasPassword ? (
            unlocked ? (
              <Badge tone="green">已解锁</Badge>
            ) : (
              <Badge>未解锁</Badge>
            )
          ) : (
            <Badge tone="amber">未设置密码</Badge>
          )}
        </div>

        {!activity.hasPassword ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              设置管理员密码后，才能使用回滚等高级功能。密码只保存在服务器上，用于校验管理员操作。
            </p>
            <div className="mt-4 space-y-3">
              <Field label="设置密码">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="至少 4 位"
                  maxLength={128}
                />
              </Field>
              <Field label="确认密码">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  maxLength={128}
                />
              </Field>
              <Button className="w-full" disabled={busy} onClick={() => void handleSetPassword()}>
                设置密码
              </Button>
            </div>
          </>
        ) : unlocked ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              已解锁管理员功能，可以回滚历史记录、修改活动信息、关闭活动。密码保存在当前浏览器会话中。
            </p>
            <div className="mt-4">
              <Button variant="secondary" className="w-full" onClick={() => void reload()}>
                刷新数据
              </Button>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-teal-600">
                修改密码
              </summary>
              <div className="mt-3 space-y-3">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="新密码（至少 4 位）"
                  maxLength={128}
                />
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="确认新密码"
                  maxLength={128}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void handleSetPassword()}
                >
                  保存新密码
                </Button>
              </div>
            </details>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              输入管理员密码以使用回滚、关闭活动等管理功能。密码会保存在当前浏览器会话中。
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="管理员密码"
                maxLength={128}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleUnlock();
                }}
              />
              <Button className="shrink-0" disabled={busy} onClick={() => void handleUnlock()}>
                解锁
              </Button>
            </div>
          </>
        )}
      </Card>

      {unlocked ? (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900">活动信息</h2>
          <div className="mt-4 space-y-3">
            <Field label="活动名称">
              <Input
                value={name ?? activity.name}
                onChange={(event) => setName(event.target.value)}
                maxLength={30}
              />
            </Field>
            <Field label="活动说明" hint="选填">
              <Textarea
                value={description ?? activity.description ?? ""}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={200}
              />
            </Field>
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => void handleSaveSettings()}
            >
              保存活动信息
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">关闭活动</h2>
          {activity.closedAt !== undefined ? <Badge tone="green">已关闭</Badge> : <Badge>进行中</Badge>}
        </div>
        {activity.closedAt !== undefined ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              活动已关闭，账目已锁定，转账方案已生成。
              {activity.closedForced
                ? "这次是强制关闭：已登记的付款与分摊视为成立，没有任何登记且未表态的成员按「未参与」处理。"
                : ""}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-gray-400">
              如需修改，请在「记录」中回滚关闭操作（需要管理员密码）。
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              结算转账方案只有在关闭活动后才会生成。所有成员都确认后可以直接关闭；如果还有人没有回应，可以强制关闭，未确认的成员将按「未参与」处理。
            </p>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              disabled={busy}
              onClick={onGoToSettlement}
            >
              前往「结算」关闭活动
            </Button>
          </>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-gray-900">高级功能</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-gray-500">
          <li>· 回滚：在「记录」里选择任意一条记录，撤销它之后的所有变更。</li>
          <li>· 活动信息：改名或修改说明。</li>
          <li>· 管理员密码：保护以上操作，避免误触。</li>
        </ul>
        {!unlocked ? (
          <p className="mt-3 text-xs text-gray-400">解锁管理员模式后即可使用。</p>
        ) : null}
      </Card>

      {busy ? <Spinner label="处理中…" /> : null}
    </div>
  );
}
