import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { useActivity } from "@/hooks/useActivity";
import { IdentityBadge } from "@/components/IdentityBadge";
import { IdentitySheet } from "@/components/IdentitySheet";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast-context";
import {
  clearAdminPassword,
  loadAdminPassword,
  rememberActivity,
  saveAdminPassword,
} from "@/lib/storage";
import { PaymentsTab } from "./tabs/PaymentsTab";
import { SettlementTab } from "./tabs/SettlementTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { AdminTab } from "./tabs/AdminTab";

type TabKey = "payments" | "settlement" | "history" | "admin";

const TABS: { key: TabKey; label: string }[] = [
  { key: "payments", label: "账目" },
  { key: "settlement", label: "结算" },
  { key: "history", label: "记录" },
  { key: "admin", label: "管理" },
];

export default function ActivityPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const controller = useActivity(id);
  const { view, status, me, setIdentity, run, notFound, error, reload } = controller;
  const [tab, setTab] = useState<TabKey>("payments");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState<string | null>(() =>
    loadAdminPassword(id),
  );
  const [adminPasswordForId, setAdminPasswordForId] = useState(id);

  const activityName = view?.activity.name;

  useEffect(() => {
    if (id && activityName) rememberActivity(id, activityName);
  }, [id, activityName]);

  // Reset the unlocked admin password when navigating to another activity.
  if (adminPasswordForId !== id) {
    setAdminPasswordForId(id);
    setAdminPassword(loadAdminPassword(id));
  }

  async function handleCreateIdentity(name: string) {
    if (!view) return;
    const before = new Set(view.identities.map((identity) => identity.id));
    try {
      const next = await run({ type: "identity.create", name });
      const created = next.identities.find((identity) => !before.has(identity.id));
      if (created) {
        setIdentity(created.id);
        setSwitcherOpen(false);
      }
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "创建身份失败", "error");
    }
  }

  async function share() {
    const url = `${window.location.origin}/a/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show("链接已复制，发给朋友即可加入", "success");
    } catch {
      toast.show(url, "info");
    }
  }

  function handleUnlocked(password: string) {
    saveAdminPassword(id, password);
    setAdminPassword(password);
  }

  function handleLocked() {
    clearAdminPassword(id);
    setAdminPassword(null);
  }

  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-md px-4">
        <Spinner label="加载活动…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-16">
        <EmptyState
          title="活动不存在"
          description="链接可能不完整，或活动已被删除"
          action={
            <Button variant="secondary" onClick={() => navigate("/")}>
              返回首页
            </Button>
          }
        />
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-16">
        <EmptyState
          title="加载失败"
          description={error?.message ?? "请稍后再试"}
          action={
            <Button variant="secondary" onClick={reload}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  const activePaymentCount = view.payments.filter((payment) => !payment.voided).length;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-30 border-b border-gray-200/70 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-1.5 px-2 py-2.5">
          <button
            type="button"
            aria-label="返回首页"
            onClick={() => navigate("/")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
              <path
                d="M12 5l-5 5 5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-gray-900">
              {view.activity.name}
            </h1>
            <p className="truncate text-xs text-gray-400">
              {view.identities.length} 位成员 · {activePaymentCount} 笔账目
            </p>
          </div>

          <button
            type="button"
            onClick={() => void share()}
            className="flex h-10 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-teal-600 hover:bg-teal-50"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M8 12a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5L9.5 5.5M12 8a3.5 3.5 0 0 0-5 0L4.5 10.5a3.54 3.54 0 0 0 5 5l1-1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            邀请
          </button>

          {me ? (
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              className="flex h-10 max-w-28 items-center gap-1.5 rounded-full pr-2 pl-1 hover:bg-gray-100"
            >
              <IdentityBadge identity={me} size="sm" />
              <span className="truncate text-sm font-medium text-gray-700">{me.name}</span>
            </button>
          ) : null}
        </div>
      </header>

      <main className="flex-1 px-4 pt-4">
        {tab === "payments" ? <PaymentsTab controller={controller} /> : null}
        {tab === "settlement" ? <SettlementTab controller={controller} /> : null}
        {tab === "history" ? (
          <HistoryTab
            controller={controller}
            adminPassword={adminPassword}
            onUnlocked={handleUnlocked}
          />
        ) : null}
        {tab === "admin" ? (
          <AdminTab
            controller={controller}
            adminPassword={adminPassword}
            onUnlocked={handleUnlocked}
            onLocked={handleLocked}
          />
        ) : null}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-md">
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className="flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5"
              >
                <TabIcon name={item.key} active={active} />
                <span
                  className={`text-[11px] font-medium ${active ? "text-teal-600" : "text-gray-400"}`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <IdentitySheet
        open={!me || switcherOpen}
        dismissible={Boolean(me)}
        identities={view.identities}
        currentId={me?.id ?? null}
        busy={controller.busy}
        onSelect={(identityId) => {
          setIdentity(identityId);
          setSwitcherOpen(false);
        }}
        onCreate={(name) => void handleCreateIdentity(name)}
        onClose={() => setSwitcherOpen(false)}
      />
    </div>
  );
}

function TabIcon({ name, active }: { name: TabKey; active: boolean }) {
  const className = `h-5 w-5 ${active ? "text-teal-600" : "text-gray-400"}`;
  if (name === "payments") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={className}>
        <path
          d="M5 3.5h10a1 1 0 0 1 1 1v12l-2.5-1.5L11 16.5 8.5 15 6 16.5l-2 .5v-12.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 7.5h4M8 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "settlement") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={className}>
        <path
          d="M4 7h11m0 0-2.5-2.5M15 7l-2.5 2.5M16 13H5m0 0 2.5-2.5M5 13l2.5 2.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === "history") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={className}>
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 3.5v1.6M10 14.9v1.6M16.5 10h-1.6M5.1 10H3.5m10.6-4.6-1.1 1.1M7 13l-1.1 1.1m0-8.2L7 7m6 6 1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
