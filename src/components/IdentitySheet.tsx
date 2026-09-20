import { useState } from "react";
import type { Identity } from "@shared/domain";
import { IdentityBadge } from "@/components/IdentityBadge";
import { Button, Input, Sheet } from "@/components/ui";

export function IdentitySheet({
  open,
  dismissible,
  identities,
  currentId,
  busy,
  onSelect,
  onCreate,
  onClose,
}: {
  open: boolean;
  dismissible: boolean;
  identities: Identity[];
  currentId: string | null;
  busy?: boolean;
  onSelect: (identityId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

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
        {identities.map((identity) => (
          <button
            key={identity.id}
            type="button"
            onClick={() => onSelect(identity.id)}
            disabled={busy}
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              identity.id === currentId
                ? "border-teal-500 bg-teal-50/60"
                : "border-gray-200 bg-white hover:bg-gray-50"
            }`}
          >
            <IdentityBadge identity={identity} />
            <span className="flex-1 truncate text-[15px] font-medium text-gray-800">
              {identity.name}
              {identity.isCreator ? (
                <span className="ml-1.5 text-xs font-normal text-gray-400">创建者</span>
              ) : null}
            </span>
            {identity.id === currentId ? (
              <span className="text-xs font-medium text-teal-600">当前</span>
            ) : null}
          </button>
        ))}
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
