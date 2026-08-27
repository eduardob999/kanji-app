/**
 * Local calendar days.
 *
 * A "day" in this app is the learner's day, not UTC's. Someone reviewing at
 * 11pm in Tokyo has studied today, and a UTC key would file it under tomorrow
 * and break their streak at the same time every evening.
 *
 * Shared by `storage/reviewLog.ts`, which names its documents by day, and
 * `domain/progress.ts`, which counts them — two copies of this would be two
 * copies that eventually disagree about which day a review belongs to, which
 * would show up as a streak that resets for no reason.
 */

/** `YYYY-MM-DD` in local time. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `days` later, or earlier when negative.
 *
 * Via `setDate`, which rolls months and years over correctly — adding 86.4
 * million milliseconds does not, across a daylight-saving boundary.
 */
export function shiftDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}
