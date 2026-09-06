export function parsePositiveIntegerConfig(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function requireRetentionDays(value: unknown): number {
  const days = parsePositiveIntegerConfig(value);
  if (days === null) throw new Error("RAW_RETENTION_DAYS must be a positive integer");
  return days;
}
