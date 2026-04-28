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

export function getNextWorkdayInTimeZone(date: Date, timeZone: string): LocalDateParts {
  const today = getLocalDateInTimeZone(date, timeZone);
  let nextDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));

  while (true) {
    const isWeekend = nextDate.getUTCDay() === 0 || nextDate.getUTCDay() === 6;
    const datePartsAtMidnight = {
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      hour: 0,
      minute: 0,
      isoDate: formatIsoDate({
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
      }),
    };
    const isHoliday = isCzechNationalHoliday(datePartsAtMidnight);

    if (!isWeekend && !isHoliday) {
      break;
    }

    nextDate = new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate() + 1));
  }

  const year = nextDate.getUTCFullYear();
  const month = nextDate.getUTCMonth() + 1;
  const day = nextDate.getUTCDate();

  return {
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    isoDate: formatIsoDate({ year, month, day }),
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

/**
 * Calculates Easter Sunday for a given year using the Computus algorithm (Gregorian calendar)
 */
function calculateEasterSunday(year: number): LocalDateParts {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return {
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    isoDate: formatIsoDate({ year, month, day }),
  };
}

/**
 * Gets all Czech national holidays for a given year
 */
export function getCzechNationalHolidays(year: number): LocalDateParts[] {
  const easter = calculateEasterSunday(year);
  const easterDate = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));

  // Good Friday is 2 days before Easter
  const goodFriday = new Date(easterDate);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);

  // Easter Monday is 1 day after Easter
  const easterMonday = new Date(easterDate);
  easterMonday.setUTCDate(easterMonday.getUTCDate() + 1);

  const holidays: LocalDateParts[] = [
    
    // --- Fixed holidays ---
    { year, month: 1, day: 1, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 1, day: 1 }) }, // New Year's Day
    { year, month: 5, day: 1, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 5, day: 1 }) }, // Labour Day
    { year, month: 5, day: 8, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 5, day: 8 }) }, // Liberation Day
    { year, month: 7, day: 5, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 7, day: 5 }) }, // Sts. Cyril and Methodius Day
    { year, month: 7, day: 6, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 7, day: 6 }) }, // Jan Hus Day
    { year, month: 9, day: 28, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 9, day: 28 }) }, // Czech Statehood Day
    { year, month: 10, day: 28, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 10, day: 28 }) }, // Founding of Czech State
    { year, month: 11, day: 17, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 11, day: 17 }) }, // Struggle for Freedom and Democracy Day
    { year, month: 12, day: 24, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 12, day: 24 }) }, // Christmas Eve
    { year, month: 12, day: 25, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 12, day: 25 }) }, // Christmas Day
    { year, month: 12, day: 26, hour: 0, minute: 0, isoDate: formatIsoDate({ year, month: 12, day: 26 }) }, // St. Stephen's Day

    // --- Easter-dependent holidays ---

    // Good Friday
    {
      year: goodFriday.getUTCFullYear(),
      month: goodFriday.getUTCMonth() + 1,
      day: goodFriday.getUTCDate(),
      hour: 0,
      minute: 0,
      isoDate: formatIsoDate({
        year: goodFriday.getUTCFullYear(),
        month: goodFriday.getUTCMonth() + 1,
        day: goodFriday.getUTCDate(),
      }),
    },

    // Easter Monday
    {
      year: easterMonday.getUTCFullYear(),
      month: easterMonday.getUTCMonth() + 1,
      day: easterMonday.getUTCDate(),
      hour: 0,
      minute: 0,
      isoDate: formatIsoDate({
        year: easterMonday.getUTCFullYear(),
        month: easterMonday.getUTCMonth() + 1,
        day: easterMonday.getUTCDate(),
      }),
    }
  ];

  return holidays;
}

/**
 * Checks if a date is a Czech national holiday
 */
export function isCzechNationalHoliday(parts: LocalDateParts): boolean {
  const holidays = getCzechNationalHolidays(parts.year);
  return holidays.some((h) => h.year === parts.year && h.month === parts.month && h.day === parts.day);
}
