import type { ComponentProps } from "react";
import type { Identity } from "@shared/domain";

type AvatarSize = "sm" | "md" | "lg" | "xl";

const avatarSizes: Record<AvatarSize, string> = {
  sm: "h-6 w-6 text-[11px]",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
  xl: "h-20 w-20 text-3xl",
};

export type AvatarIdentity = Pick<Identity, "name" | "color"> & { avatar?: string };

export function Avatar({
  identity,
  size = "md",
  className = "",
}: {
  identity: AvatarIdentity;
  size?: AvatarSize;
  className?: string;
}) {
  if (identity.avatar) {
    return (
      <img
        src={identity.avatar}
        alt={identity.name}
        className={`shrink-0 rounded-full object-cover ${avatarSizes[size]} ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${avatarSizes[size]} ${className}`}
      style={{ backgroundColor: identity.color }}
    >
      {identity.name.slice(0, 1)}
    </span>
  );
}

export function UserPill({
  identity,
  size = "md",
  selected = false,
  muted = false,
  highlight = false,
  tag,
  onClick,
  trailing,
  className = "",
}: {
  identity: AvatarIdentity;
  size?: AvatarSize;
  selected?: boolean;
  muted?: boolean;
  /** Emphasized style, used for the payment creator. */
  highlight?: boolean;
  /** Tiny label rendered inside the pill, e.g. 创建人. */
  tag?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const content = (
    <>
      <Avatar identity={identity} size={size} />
      <span className={`truncate ${muted ? "text-gray-400" : ""}`}>{identity.name}</span>
      {tag ? (
        <span className="shrink-0 rounded-full bg-teal-600/10 px-1.5 py-px text-[10px] font-medium text-teal-700">
          {tag}
        </span>
      ) : null}
      {trailing}
    </>
  );

  const tone = highlight
    ? "bg-teal-50 text-teal-800 ring-1 ring-teal-300"
    : selected
      ? "bg-teal-50 text-teal-700 ring-1 ring-teal-500"
      : muted
        ? "bg-gray-50 text-gray-400"
        : "bg-gray-100 text-gray-700";

  const classes = `inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-3 pl-0.5 text-sm ${tone} ${className}`;

  if (!onClick) return <span className={classes}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${classes} transition-colors hover:brightness-[0.97] disabled:opacity-50`}
    >
      {content}
    </button>
  );
}

/** Pill for an unknown/deleted identity. */
export function GhostPill({ label = "未知用户" }: { label?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-gray-50 py-0.5 pr-3 pl-0.5 text-sm text-gray-400">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-white">
        ?
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export type UserPillProps = ComponentProps<typeof UserPill>;
