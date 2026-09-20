import { useState } from "react";
import type { Identity } from "@shared/domain";
import { Avatar } from "@/components/IdentityBadge";
import { Button, Input, Sheet } from "@/components/ui";
import { ProfileSheet } from "@/components/ProfileSheet";
import type { RunCommand } from "@/hooks/useActivity";

export function IdentitySheet({
  open,
  dismissible,
  identities,
  currentId,
  busy,
  run,
  onSelect,
  onCreate,
  onClose,
}: {
  open: boolean;
  dismissible: boolean;
  identities: Identity[];
  currentId: string | null;
  busy?: boolean;
  run: RunCommand;
  onSelect: (identityId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);

  const me = identities.find((identity) => identity.id === currentId) ?? null;

  if (editing && me) {
    return <ProfileSheet me={me} busy={busy} run={run} onClose={() => setEditing(false)} />;
  }

  return (
    <Sheet
      open={open}
      closable={dismissible}
      onClose={onClose}
      title={currentId ? "切换身份" : "你是谁？"}
    >
      <p className="text-sm leading-relaxed text-gray-500">
        选择你的身份，或创建一个新身份。身份无需密码，换台设备重新选择即可；也正因如此，请不要冒用他人身份。
      </p>

      <div className="mt-4 space-y-2">
        {identities.map((identity) => {
          const isMe = identity.id === currentId;
          return (
            <div
              key={identity.id}
              className={`flex items-center gap-1 rounded-full border py-1 pr-1 pl-1 transition-colors ${
                isMe ? "border-teal-500 bg-teal-50/60" : "border-gray-200 bg-white"
              }`}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => onSelect(identity.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-1.5 py-1 text-left"
              >
                <Avatar identity={identity} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-800">
                  {identity.name}
                </span>
                {identity.isCreator ? (
                  <span className="shrink-0 text-xs text-gray-400">创建者</span>
                ) : null}
                {isMe ? <span className="shrink-0 text-xs font-medium text-teal-600">当前</span> : null}
              </button>
              {isMe ? (
                <button
                  type="button"
                  aria-label="编辑我的资料"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-gray-600"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                    <path
                      d="M13.5 4.5l2 2L7 15l-2.5.5L5 13l8.5-8.5Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <form
        className="mt-5 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (!value) return;
          onCreate(value);
          setName("");
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="新身份的名字"
          maxLength={20}
        />
        <Button type="submit" disabled={!name.trim() || busy} className="shrink-0">
          创建
        </Button>
      </form>
    </Sheet>
  );
}
