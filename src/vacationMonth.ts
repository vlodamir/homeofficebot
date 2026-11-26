import { getCzechNationalHolidays } from "./date";
import { PlannedOutOfOffice } from "./types";

const MS_PER_DAY = 86_400_000;
const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function shiftVacationMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function daysBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / MS_PER_DAY;
}

export interface VacationSpan {
  firstDay: number;
  lastDay: number;
  duration?: number;
}

export function buildVacationMonth(month: string, today: string, entries: PlannedOutOfOffice[]) {
  const start = `${month}-01`;
  const next = `${shiftVacationMonth(month, 1)}-01`;
  const dayCount = daysBetween(start, next);
  const vacations = entries
    .filter((entry) => entry.type === "vacation" && entry.startDate < next && (!entry.endDate || entry.endDate >= start))
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id));

  const spansByEmployee = new Map<string, VacationSpan[]>();
  const employeesByDay = Array.from({ length: dayCount }, () => new Set<string>());
  for (const entry of vacations) {
    const firstDay = daysBetween(start, entry.startDate) + 1;
    const lastDay = entry.endDate ? daysBetween(start, entry.endDate) + 1 : Infinity;
    const span = { firstDay, lastDay, duration: entry.endDate ? lastDay - firstDay + 1 : undefined };
    const employeeSpans = spansByEmployee.get(entry.userId) ?? [];
    const previous = employeeSpans[employeeSpans.length - 1];
    if (previous && firstDay <= previous.lastDay) {
      previous.lastDay = Math.max(previous.lastDay, lastDay);
      previous.duration = Number.isFinite(previous.lastDay) ? previous.lastDay - previous.firstDay + 1 : undefined;
    } else {
      employeeSpans.push(span);
    }
    spansByEmployee.set(entry.userId, employeeSpans);

    for (let day = Math.max(1, firstDay); day <= Math.min(dayCount, lastDay); day++) {
      employeesByDay[day - 1].add(entry.userId);
    }
  }

  const firstDate = new Date(start);
  const firstWeekday = firstDate.getUTCDay();
  const holidayDays = new Set(getCzechNationalHolidays(firstDate.getUTCFullYear())
    .filter((holiday) => holiday.month === firstDate.getUTCMonth() + 1)
    .map((holiday) => holiday.day));
  return {
    month,
    label: monthFormat.format(firstDate),
    today: today.startsWith(`${month}-`) ? Number(today.slice(8)) : undefined,
    vacations,
    employees: [...spansByEmployee].map(([userId, spans]) => ({ userId, spans })),
    days: employeesByDay.map((employees, index) => ({
      day: index + 1,
      weekday: (firstWeekday + index) % 7,
      holiday: holidayDays.has(index + 1),
      away: employees.size,
    })),
  };
}

export type VacationMonth = ReturnType<typeof buildVacationMonth>;
