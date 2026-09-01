const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat();

/** Compact above four digits, exact below — a dashboard should not round 847 to 0.8K. */
export function formatCount(n: number): string {
  return n < 10_000 ? plain.format(n) : compact.format(n);
}

export function formatDelta(current: number, previous: number) {
  if (previous === 0) {
    return current === 0
      ? { text: "no change", direction: "flat" as const }
      : { text: "new", direction: "up" as const };
  }
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change);
  if (rounded === 0) return { text: "0%", direction: "flat" as const };
  return {
    text: `${rounded > 0 ? "+" : ""}${rounded}%`,
    direction: rounded > 0 ? ("up" as const) : ("down" as const),
  };
}

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRelative(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.round(unixSeconds - now / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds), "second");
}
