/** The API returns Postgres numeric as a string and nullable columns as null,
 *  so every formatter normalises rather than forcing 100 call sites to. */
export function formatCurrency(
  input: number | string | null | undefined,
  options?: { compact?: boolean },
) {
  const value = Number(input ?? 0);
  if (options?.compact) {
    if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
    if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)} K`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(input: number | string | null | undefined) {
  const value = Number(input ?? 0);
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatPercent(input: number | string | null | undefined, digits = 1) {
  const value = Number(input ?? 0);
  return `${value.toFixed(digits)}%`;
}

export function formatDate(input: string | null | undefined) {
  if (!input) return "—";
  const value = input;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(input: string | null | undefined) {
  if (!input) return "—";
  const value = input;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(input: string | null | undefined) {
  if (!input) return "—";
  const value = input;
  const date = new Date(value).getTime();
  const now = Date.now();
  const diff = Math.round((date - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];
  let amount = diff;
  for (const [unit, step] of units) {
    if (Math.abs(amount) < step) {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        Math.round(amount),
        unit,
      );
    }
    amount /= step;
  }
  return formatDate(value);
}

export function maskAccount(input: string | null | undefined) {
  if (!input) return "—";
  const value = input;
  if (value.length <= 4) return value;
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
