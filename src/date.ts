import { LocalDateParts } from "./types";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatIsoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function parseIsoDate(isoDate: string): LocalDateParts {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  return {
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    isoDate,
  };
}

export function getLocalDateInTimeZone(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const year = Number.parseInt(values.year, 10);
  const month = Number.parseInt(values.month, 10);
  const day = Number.parseInt(values.day, 10);
  const hour = Number.parseInt(values.hour, 10);
  const minute = Number.parseInt(values.minute, 10);

  return {
    year,
    month,
    day,
    hour,
    minute,
    isoDate: formatIsoDate({ year, month, day }),
  };
}

export function getTomorrowInTimeZone(date: Date, timeZone: string): LocalDateParts {
  const today = getLocalDateInTimeZone(date, timeZone);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));

  return {
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
    hour: 0,
    minute: 0,
    isoDate: formatIsoDate({
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
    }),
  };
}

export function getCzechWeekdayName(parts: LocalDateParts): string {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    timeZone: "UTC",
  }).format(utcDate);

  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

export function getCzechWeekdayNameFromIso(isoDate: string): string {
  return getCzechWeekdayName(parseIsoDate(isoDate));
}

export function isWeekendInTimeZone(date: Date, timeZone: string): boolean {
  const localDate = getLocalDateInTimeZone(date, timeZone);
  const utcDate = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day));
  const dayOfWeek = utcDate.getUTCDay();

  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function isWeekendLocalDateParts(parts: LocalDateParts): boolean {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = utcDate.getUTCDay();

  return dayOfWeek === 0 || dayOfWeek === 6;
}