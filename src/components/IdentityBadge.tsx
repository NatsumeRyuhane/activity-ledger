import type { Identity } from "@shared/domain";

export function IdentityBadge({
  identity,
  size = "md",
  className = "",
}: {
  identity: Pick<Identity, "name" | "color">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass =
    size === "sm" ? "h-6 w-6 text-[11px]" : size === "lg" ? "h-11 w-11 text-lg" : "h-8 w-8 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${sizeClass} ${className}`}
      style={{ backgroundColor: identity.color }}
    >
      {identity.name.slice(0, 1)}
    </span>
  );
}

export function IdentityChip({
  identity,
  dimmed = false,
  onClick,
}: {
  identity: Pick<Identity, "name" | "color">;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <IdentityBadge identity={identity} size="sm" />
      <span className={`truncate ${dimmed ? "text-gray-400" : "text-gray-700"}`}>
        {identity.name}
      </span>
    </>
  );
  if (!onClick) {
    return (
      <span className="inline-flex max-w-40 items-center gap-1.5 rounded-full bg-gray-50 py-0.5 pr-2.5 pl-0.5 text-sm">
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-40 items-center gap-1.5 rounded-full bg-gray-50 py-0.5 pr-2.5 pl-0.5 text-sm hover:bg-gray-100"
    >
      {content}
    </button>
  );
}
