/** İcma elanları: ən tez növbəti tam saat (məs. 21:30 → 22:00, 10:05 → 11:00). */
export function nextSelectableHour(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next;
}

export function isBeforeSelectableHour(value: Date, from: Date = new Date()): boolean {
  return value.getTime() < nextSelectableHour(from).getTime();
}
