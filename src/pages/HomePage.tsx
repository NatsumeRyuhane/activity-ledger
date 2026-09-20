import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createActivity } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import {
  forgetActivity,
  loadRecentActivities,
  rememberActivity,
  saveIdentityId,
  type RecentActivity,
} from "@/lib/storage";
import { formatRelative } from "@/lib/format";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";

export default function HomePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [name, setName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [recent, setRecent] = useState<RecentActivity[]>(() => loadRecentActivities());

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.show("请填写活动名称", "error");
      return;
    }
    if (!creatorName.trim()) {
      toast.show("请填写你的名字", "error");
      return;
    }
    setSubmitting(true);
    try {
      const { activityId, identityId } = await createActivity({
        name: name.trim(),
        creatorName: creatorName.trim(),
        description: description.trim() || undefined,
        password: password.trim() || undefined,
      });
      saveIdentityId(activityId, identityId);
      rememberActivity(activityId, name.trim());
      toast.show("活动已创建", "success");
      navigate(`/a/${activityId}`);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "创建失败，请稍后再试", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const raw = joinId.trim();
    if (!raw) return;
    const match = /\/a\/([0-9a-z]+)/i.exec(raw);
    const id = match ? match[1] : raw;
    navigate(`/a/${id}`);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-16 pt-8">
      <header className="mb-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-600 text-lg font-bold text-white">
            账
          </span>
          <div>
            <h1 className="text-xl font-bold text-gray-900">活动账本</h1>
            <p className="text-sm text-gray-500">和朋友 AA 记账，一键算出最少转账</p>
          </div>
        </div>
      </header>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-gray-900">创建活动</h2>
        <form className="mt-4 space-y-4" onSubmit={handleCreate}>
          <Field label="活动名称">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：周末露营"
              maxLength={30}
            />
          </Field>
          <Field label="你的名字">
            <Input
              value={creatorName}
              onChange={(event) => setCreatorName(event.target.value)}
              placeholder="在活动里显示的名字"
              maxLength={20}
            />
          </Field>

          {showOptional ? (
            <>
              <Field label="活动说明" hint="选填">
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="时间、地点、备注……"
                  maxLength={200}
                />
              </Field>
              <Field label="管理员密码" hint="选填">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="设置后可用于回滚等管理操作"
                  maxLength={128}
                />
              </Field>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowOptional(true)}
              className="text-sm font-medium text-teal-600"
            >
              + 添加说明或管理员密码
            </button>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "创建中…" : "创建活动"}
          </Button>
        </form>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-base font-semibold text-gray-900">加入活动</h2>
        <form className="mt-3 flex items-center gap-2" onSubmit={handleJoin}>
          <Input
            value={joinId}
            onChange={(event) => setJoinId(event.target.value)}
            placeholder="粘贴活动链接或活动 ID"
          />
          <Button type="submit" variant="secondary" disabled={!joinId.trim()} className="shrink-0">
            进入
          </Button>
        </form>
      </Card>

      {recent.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-sm font-medium text-gray-500">我参与的活动</h2>
          <Card className="divide-y divide-gray-100">
            {recent.map((item) => (
              <div key={item.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => navigate(`/a/${item.id}`)}
                  className="flex flex-1 items-center justify-between gap-2 px-4 py-3 text-left"
                >
                  <span className="truncate text-[15px] font-medium text-gray-800">{item.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {formatRelative(item.visitedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="从列表移除"
                  onClick={() => {
                    forgetActivity(item.id);
                    setRecent(loadRecentActivities());
                  }}
                  className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                    <path
                      d="M5 5l10 10M15 5L5 15"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <p className="mt-8 px-2 text-center text-xs leading-relaxed text-gray-400">
        账本以活动为单位，链接就是钥匙。身份无需密码，请与信任的朋友一起使用。
      </p>
    </div>
  );
}
