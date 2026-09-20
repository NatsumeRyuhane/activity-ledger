import { useState } from "react";
import type { Identity } from "@shared/domain";
import { Avatar, UserPill } from "@/components/IdentityBadge";
import { Sheet } from "@/components/ui";

export function IdentityPicker({
  value,
  options,
  onSelect,
  disabled,
}: {
  value: Identity;
  options: Identity[];
  onSelect: (identityId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-full bg-gray-100 py-0.5 pr-2 pl-0.5 text-left disabled:opacity-60"
      >
        <Avatar identity={value} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{value.name}</span>
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 text-gray-400">
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title="选择成员">
          <div className="space-y-2">
            {options.map((identity) => (
              <button
                key={identity.id}
                type="button"
                onClick={() => {
                  onSelect(identity.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-full border px-2 py-1.5 text-left ${
                  identity.id === value.id
                    ? "border-teal-500 bg-teal-50/60"
                    : "border-gray-200 bg-white"
                }`}
              >
                <Avatar identity={identity} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-800">
                  {identity.name}
                </span>
              </button>
            ))}
            {options.length === 0 ? (
              <p className="py-2 text-center text-sm text-gray-400">没有可选的成员了</p>
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

export { UserPill };
