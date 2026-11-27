import test from "node:test";
import assert from "node:assert/strict";
import { getLocalDateInTimeZone } from "../src/date";
import { PlannedOutOfOffice } from "../src/types";
import { buildVacationMonth, shiftVacationMonth } from "../src/vacationMonth";
import { renderVacationTimeline } from "../src/vacationTimeline";

function vacation(userId: string, startDate: string, endDate?: string): PlannedOutOfOffice {
  return { id: `${userId}-${startDate}`, type: "vacation", userId, startDate, endDate };
}

test("cross-month vacations retain their full duration with inclusive days in both months", () => {
  const entries = [vacation("U1", "2026-11-29", "2026-12-03")];
  const november = buildVacationMonth("2026-11", "2026-11-26", entries);
  const december = buildVacationMonth("2026-12", "2026-11-26", entries);
  assert.deepEqual(november.days.filter(({ away }) => away).map(({ day }) => day), [29, 30]);
  assert.deepEqual(december.days.filter(({ away }) => away).map(({ day }) => day), [1, 2, 3]);
  assert.equal(november.employees[0].spans[0].duration, 5);
  assert.equal(december.employees[0].spans[0].duration, 5);
  assert.equal(november.today, 26);
  assert.equal(december.today, undefined);
});

test("overlap counts use employee IDs while distinct vacation periods remain visible", () => {
  const entries = [
    vacation("U1", "2026-11-01", "2026-11-03"),
    vacation("U1", "2026-11-03", "2026-11-04"),
    vacation("U1", "2026-11-16", "2026-11-16"),
    vacation("U2", "2026-11-03", "2026-11-07"),
    vacation("U3", "2026-11-30"),
    { ...vacation("U4", "2026-11-03"), type: "ho" as const },
  ];
  const timeline = buildVacationMonth("2026-11", "2026-11-26", entries);
  assert.equal(timeline.vacations.length, 5);
  assert.deepEqual(timeline.employees.map(({ userId }) => userId), ["U1", "U2", "U3"]);
  assert.deepEqual(timeline.employees[0].spans, [
    { firstDay: 1, lastDay: 4, duration: 4 },
    { firstDay: 16, lastDay: 16, duration: 1 },
  ]);
  assert.equal(timeline.days[2].away, 2);
  assert.equal(timeline.days[15].away, 1);
  assert.equal(timeline.days[29].away, 1);
});

test("February accounts for leap years and the local date determines the today marker", () => {
  const local = getLocalDateInTimeZone(new Date("2024-02-28T23:30:00Z"), "Europe/Prague").isoDate;
  const leap = buildVacationMonth("2024-02", local, [vacation("U1", "2024-02-29", "2024-02-29")]);
  assert.equal(leap.today, 29);
  assert.equal(leap.days.length, 29);
  assert.deepEqual(leap.days[28], { day: 29, weekday: 4, holiday: false, away: 1 });

  const empty = buildVacationMonth("2026-02", "2026-11-26", [vacation("U1", "2026-01-20", "2026-01-31")]);
  assert.equal(empty.days.length, 28);
  assert.equal(empty.employees.length, 0);
  assert.ok(empty.days.every(({ away }) => away === 0));
});

test("the vacation month marks fixed and movable Czech holidays, including holidays on weekends", () => {
  const december = buildVacationMonth("2026-12", "2026-11-26", []);
  assert.deepEqual(december.days.filter(({ holiday }) => holiday).map(({ day }) => day), [24, 25, 26]);
  assert.equal(december.days[25].weekday, 6);

  const april = buildVacationMonth("2026-04", "2026-11-26", []);
  assert.deepEqual(april.days.filter(({ holiday }) => holiday).map(({ day }) => day), [3, 6]);
});

test("month navigation crosses the year boundary in both directions", () => {
  assert.equal(shiftVacationMonth("2026-12", 1), "2027-01");
  assert.equal(shiftVacationMonth("2027-01", -1), "2026-12");
});

test("the renderer produces a double-width PNG with one row per employee across the month", async () => {
  const month = "2026-11";
  const today = "2026-11-26";
  const empty = await renderVacationTimeline(buildVacationMonth(month, today, []), new Map());
  const model = buildVacationMonth(month, today, [vacation("U1", "2026-11-10"), vacation("U2", "2026-11-15", "2026-11-20")]);
  const png = await renderVacationTimeline(model, new Map([["U1", { name: 'Černý & <Co.> "Team"' }]]));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 3312);
  assert.equal(png.readUInt32BE(20) - empty.readUInt32BE(20), 111);
});

test("the renderer embeds an available Slack profile avatar", async (context) => {
  const avatar = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGPQDt4IRAwQCgAfGgS9zSS7UQAAAABJRU5ErkJggg==", "base64");
  const url = "https://avatars.slack-edge.com/mock.png";
  const fetchMock = context.mock.method(globalThis, "fetch", async (request: URL) => {
    assert.equal(request.href, url);
    return new Response(new Uint8Array(avatar), { headers: { "Content-Type": "image/png" } });
  });
  const model = buildVacationMonth("2026-11", "2026-11-26", [vacation("U1", "2026-11-26", "2026-11-27")]);
  const withAvatar = await renderVacationTimeline(model, new Map([["U1", { name: "Jana", avatarUrl: url }]]));
  const withInitials = await renderVacationTimeline(model, new Map([["U1", { name: "Jana" }]]));
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(!withAvatar.equals(withInitials));
});
