const pad = (value: number) => String(value).padStart(2, "0");

/** Parses `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss]` as local time. */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    h ? Number(h) : 0,
    mi ? Number(mi) : 0,
    s ? Number(s) : 0,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string): string {
  const date = parseLocalDate(value);
  if (!date) return value;
  const hasTime = /[T ]\d{2}:\d{2}/.test(value);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const base = `${year}年${month}月${day}日`;
  return hasTime ? `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}` : base;
}

export function formatRelative(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const isToday = new Date(now).toDateString() === date.toDateString();
  if (isToday) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now - 86_400_000).toDateString() === date.toDateString();
  if (yesterday) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** Value for a `<input type="datetime-local">` prefill. */
export function nowInputValue(): string {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
