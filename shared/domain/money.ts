const yuanFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function parseYuanToCents(input: string): number | null {
  const s = input.trim().replace(/[¥￥,，\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [yuan, frac = ""] = s.split(".");
  const cents = Number(yuan) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export function centsToYuanInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatYuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}¥${yuanFormatter.format(Math.abs(cents) / 100)}`;
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
