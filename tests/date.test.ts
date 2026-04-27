import test from "node:test";
import assert from "node:assert/strict";
import { getLocalDateInTimeZone, getNextWorkdayInTimeZone, isWeekendLocalDateParts } from "../src/date";

const timezone = "Europe/Prague";

test("getNextWorkdayInTimeZone returns Monday when the current local day is Friday", () => {
  const targetDate = getNextWorkdayInTimeZone(new Date("2026-04-24T16:00:00Z"), timezone);

  assert.equal(targetDate.isoDate, "2026-04-27");
});

test("getNextWorkdayInTimeZone returns the next day from Monday through Thursday", () => {
  const cases = [
    ["2026-04-27T16:00:00Z", "2026-04-28"],
    ["2026-04-28T16:00:00Z", "2026-04-29"],
    ["2026-04-29T16:00:00Z", "2026-04-30"],
    ["2026-04-30T16:00:00Z", "2026-05-01"],
  ] as const;

  for (const [now, expectedTargetDate] of cases) {
    assert.equal(getNextWorkdayInTimeZone(new Date(now), timezone).isoDate, expectedTargetDate);
  }
});

test("weekend local dates are detectable for scheduler skipping", () => {
  const saturday = getLocalDateInTimeZone(new Date("2026-04-25T16:00:00Z"), timezone);
  const sunday = getLocalDateInTimeZone(new Date("2026-04-26T16:00:00Z"), timezone);

  assert.equal(isWeekendLocalDateParts(saturday), true);
  assert.equal(isWeekendLocalDateParts(sunday), true);
});
