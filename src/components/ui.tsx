import type { ComponentProps, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-teal-600 text-white shadow-sm hover:bg-teal-700 active:bg-teal-800 disabled:bg-teal-600/50",
  secondary:
    "bg-white text-gray-800 border border-gray-300 shadow-sm hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50",
  ghost: "text-gray-600 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 disabled:bg-red-600/50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
    />
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-gray-200/80 bg-white shadow-sm ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {hint ? <span className="text-xs text-gray-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const controlClass =
  "w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-base text-gray-900 placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-gray-50";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${controlClass} ${className}`} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${controlClass} min-h-20 resize-y ${className}`} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${controlClass} appearance-none ${className}`} />;
}

type BadgeTone = "gray" | "teal" | "green" | "red" | "amber";

const badgeTones: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-600",
  teal: "bg-teal-50 text-teal-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-600",
  amber: "bg-amber-50 text-amber-700",
};

export function Badge({
  tone = "gray",
  className = "",
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]} ${className}`}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-xl bg-gray-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`min-h-9 flex-1 rounded-lg text-sm font-medium transition-colors ${
            value === option.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  closable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closable?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {closable ? (
        <button
          type="button"
          aria-label="关闭"
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
        />
      ) : (
        <div className="absolute inset-0 bg-black/40" />
      )}
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {closable ? (
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
              aria-label="关闭"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-gray-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-10 text-center">
      <p className="text-[15px] font-medium text-gray-700">{title}</p>
      {description ? <p className="text-sm text-gray-400">{description}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-teal-600" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
