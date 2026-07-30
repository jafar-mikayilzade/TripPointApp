/** Shared trip schedule helpers for AI and QUR screens. */

import { nextSelectableHour } from './listingSchedule';

/** OpenWeather 5-day forecast window (0 = today). */
const WEATHER_FORECAST_MAX_OFFSET = 4;

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function combineDateAndHour(day: Date, hour: number, minute = 0): Date {
  const next = startOfDay(day);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function formatHhMm(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Days from today (local), never negative. */
export function startDayOffsetFromDate(date: Date): number {
  const today = startOfDay(new Date()).getTime();
  const target = startOfDay(date).getTime();
  return Math.max(0, Math.round((target - today) / 86_400_000));
}

export function isWithinWeatherForecast(date: Date): boolean {
  return startDayOffsetFromDate(date) <= WEATHER_FORECAST_MAX_OFFSET;
}

/** Default çıxış: ən tez növbəti saat, ən azı 08:00. */
export function defaultTripStartAt(): Date {
  const soonest = nextSelectableHour();
  const eight = combineDateAndHour(soonest, 8);
  return soonest.getTime() > eight.getTime() ? soonest : eight;
}

/** Default qayıdış: eyni gün 21:00 (və ya çıxışdan sonra). */
export function defaultReturnAt(startAt: Date = defaultTripStartAt()): Date {
  const twentyOne = combineDateAndHour(startAt, 21);
  if (twentyOne.getTime() > startAt.getTime()) {
    return twentyOne;
  }
  const next = new Date(startAt);
  next.setHours(startAt.getHours() + 1, 0, 0, 0);
  return next;
}

export function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('az-AZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Align return datetime with trip length.
 * - 1 day: same day, after depart (or next day if allowOvernight + earlier hour)
 * - 2+ days: last trip day, any hour
 */
export function syncReturnForTrip(
  startAt: Date,
  returnAt: Date,
  tripDays: number,
  allowOvernight = false
): Date {
  const days = Math.max(1, Math.floor(tripDays));
  const hour = returnAt.getHours();
  const minute = returnAt.getMinutes();

  if (days > 1) {
    return combineDateAndHour(addDays(startAt, days - 1), hour, minute);
  }

  const sameDay = combineDateAndHour(startAt, hour, minute);
  if (sameDay.getTime() > startAt.getTime()) {
    return sameDay;
  }
  if (allowOvernight) {
    return combineDateAndHour(addDays(startAt, 1), hour, minute);
  }
  return defaultReturnAt(startAt);
}
