import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { StateStore } from "../src/state";
import type { PlannedOutOfOffice } from "../src/types";

function statePaths(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "homeofficebot-state-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    database: path.join(directory, "state.sqlite"),
    legacy: path.join(directory, "state.json"),
  };
}

function vacation(id: string, userId: string, startDate: string, endDate?: string): PlannedOutOfOffice {
  return { id, userId, type: "vacation", startDate, endDate };
}

const message = {
  channelId: "C1",
  messageTs: "123.456",
  targetDate: "2026-11-26",
  postedAt: "2026-11-25T17:00:00.000Z",
};

test("SQLite imports existing state once and preserves history and generated IDs after restart", (t) => {
  const { database, legacy } = statePaths(t);
  const past = vacation("existing", "U1", "2026-10-12", "2026-10-13");
  const source = JSON.stringify({
    lastHoMessage: { ...message, hoUsers: ["U2"], vacationUsers: ["U3"] },
    teamMembers: ["U2", "U1", "U3"],
    plannedOutOfOffice: [past, { userId: "U2", type: "vacation", startDate: "2026-11-22" }],
  });
  writeFileSync(legacy, source);

  const initial = StateStore.open(database, legacy);
  let generatedId: string;
  try {
    assert.deepEqual(initial.getLastHoMessage(), {
      ...message, confirmedOnsiteUsers: [], hoUsers: ["U2"], vacationUsers: ["U3"],
    });
    assert.deepEqual(initial.getTeamMembers(), ["U2", "U1", "U3"]);
    assert.deepEqual(initial.getVacationsInRange("2026-10-01", "2026-11-01"), [past]);
    const [ongoing] = initial.getUpcomingPlannedOutOfOffice("2026-11-26");
    assert.equal(ongoing.endDate, undefined);
    assert.match(ongoing.id, /^[a-f\d-]{36}$/);
    generatedId = ongoing.id;
    initial.setAttendanceVote("U1", "onsite");
  } finally {
    initial.close();
  }

  assert.equal(readFileSync(legacy, "utf8"), source);
  writeFileSync(legacy, "invalid JSON after migration");
  const reopened = StateStore.open(database, legacy);
  t.after(() => reopened.close());
  assert.equal(reopened.getUpcomingPlannedOutOfOffice("2026-11-26")[0]?.id, generatedId);
  assert.deepEqual(reopened.getLastHoMessage()?.confirmedOnsiteUsers, ["U1"]);
  assert.deepEqual(reopened.getVacationsInRange("2026-10-01", "2026-11-01"), [past]);
});

test("invalid legacy state and failed inserts leave the database ready to retry the import", (t) => {
  const { database, legacy } = statePaths(t);
  const entry = vacation("one", "U1", "2026-10-01", "2026-10-01");
  writeFileSync(legacy, "{");
  assert.throws(() => StateStore.open(database, legacy), /Could not import legacy state/);

  const duplicateIds = JSON.stringify({ teamMembers: ["U1"], plannedOutOfOffice: [entry, entry] });
  writeFileSync(legacy, duplicateIds);
  assert.throws(() => StateStore.open(database, legacy), /UNIQUE constraint failed/);
  assert.equal(readFileSync(legacy, "utf8"), duplicateIds);

  const inspection = new DatabaseSync(database);
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get()?.user_version, 0);
    assert.deepEqual(inspection.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(), []);
  } finally {
    inspection.close();
  }

  writeFileSync(legacy, JSON.stringify({ teamMembers: ["U1"], plannedOutOfOffice: [entry] }));
  const retried = StateStore.open(database, legacy);
  t.after(() => retried.close());
  assert.deepEqual(retried.getTeamMembers(), ["U1"]);
  assert.equal(retried.getPlannedOutOfOfficeOn("2026-10-01")[0]?.id, entry.id);
});

test("date queries retain completed and cross-month absences with inclusive end dates", (t) => {
  const { database, legacy } = statePaths(t);
  const store = StateStore.open(database, legacy);
  t.after(() => store.close());
  assert.equal(store.getLastHoMessage(), null);
  assert.deepEqual(store.getTeamMembers(), []);

  const entries: PlannedOutOfOffice[] = [
    vacation("cross-month", "U1", "2026-10-31", "2026-11-02"),
    vacation("today", "U2", "2026-11-01", "2026-11-03"),
    vacation("indefinite", "U3", "2026-11-01"),
    vacation("next-month", "U4", "2026-12-01", "2026-12-02"),
    { id: "ho", userId: "U4", type: "ho", startDate: "2026-10-10", endDate: "2026-10-13" },
  ];
  for (const entry of entries) assert.equal(store.tryAddPlannedOutOfOffice(entry), undefined);
  assert.deepEqual(store.getPlannedOutOfOfficeOn("2026-11-02").map(({ id }) => id), ["cross-month", "today", "indefinite"]);
  assert.deepEqual(store.getUpcomingPlannedOutOfOffice("2026-11-03").map(({ id }) => id), ["today", "indefinite", "next-month"]);
  assert.deepEqual(store.getUpcomingPlannedOutOfOffice("2026-11-03", "U2").map(({ id }) => id), ["today"]);
  assert.deepEqual(store.getVacationsInRange("2026-10-01", "2026-11-01").map(({ id }) => id), ["cross-month"]);
  assert.deepEqual(
    store.getVacationsInRange("2026-11-01", "2026-12-01").map(({ id }) => id).sort(),
    ["cross-month", "indefinite", "today"],
  );
  assert.equal(store.getPlannedOutOfOfficeOn("2026-10-13")[0]?.id, "ho");
  assert.equal(store.getPlannedOutOfOfficeOn("2100-01-01")[0]?.id, "indefinite");
  assert.equal(store.removePlannedOutOfOffice("cross-month", "2026-11-03", "U1"), false);
  assert.equal(store.removePlannedOutOfOffice("today", "2026-11-03", "U1"), false);
  assert.equal(store.removePlannedOutOfOffice("today", "2026-11-03", "U2"), true);
});

test("removing team members preserves elapsed dates and clears their votes", (t) => {
  const { database } = statePaths(t);
  const store = StateStore.open(database);
  t.after(() => store.close());
  store.setTeamMembers(["U1", "U2", "U3", "U4"], "2026-10-01");
  const past = vacation("past", "U1", "2026-10-10", "2026-10-12");
  const ongoing = vacation("ongoing", "U1", "2026-10-28", "2026-11-03");
  const indefinite = vacation("indefinite", "U2", "2026-10-30");
  const unchanged = vacation("retained-member", "U4", "2026-10-30", "2026-11-02");
  const other = vacation("outside-roster", "U5", "2026-11-08", "2026-11-10");
  for (const entry of [past, ongoing, indefinite, unchanged, other,
    vacation("starts-today", "U3", "2026-11-01"),
    vacation("future", "U1", "2026-11-08", "2026-11-12")]) {
    store.tryAddPlannedOutOfOffice(entry);
  }
  store.setLastHoMessage({ ...message, hoUsers: ["U1", "U4"], vacationUsers: ["U2"], confirmedOnsiteUsers: ["U3"] });

  store.setTeamMembers(["U4", "U4"], "2026-11-01");
  assert.deepEqual(store.getTeamMembers(), ["U4"]);
  assert.deepEqual(store.getLastHoMessage(), {
    ...message, hoUsers: ["U4"], vacationUsers: [], confirmedOnsiteUsers: [],
  });
  const october = store.getVacationsInRange("2026-10-01", "2026-11-01").sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(october, [
    { ...indefinite, endDate: "2026-10-31" }, { ...ongoing, endDate: "2026-10-31" }, past, unchanged,
  ]);
  assert.deepEqual(store.getUpcomingPlannedOutOfOffice("2026-11-01"), [unchanged, other]);
});

test("independent connections serialize overlapping writes and see updates to tracked messages", (t) => {
  const { database } = statePaths(t);
  const store = StateStore.open(database);
  const other = StateStore.open(database);
  const lock = new DatabaseSync(database);
  t.after(() => store.close());
  t.after(() => other.close());
  t.after(() => lock.close());
  store.setLastHoMessage(message);
  assert.equal(other.toggleAttendanceVote(message, "U1", "ho"), "updated");
  assert.equal(store.toggleAttendanceVote(message, "U2", "onsite"), "updated");

  const planned = vacation("planned", "U1", message.targetDate, "2026-11-28");
  lock.exec("BEGIN IMMEDIATE");
  try {
    assert.throws(() => other.tryAddPlannedOutOfOffice(planned), /database is locked/);
    assert.deepEqual(store.getPlannedOutOfOfficeOn(message.targetDate), []);
    assert.deepEqual(store.getLastHoMessage()?.hoUsers, ["U1"]);
  } finally {
    lock.exec("ROLLBACK");
  }

  assert.equal(other.tryAddPlannedOutOfOffice(planned), undefined);
  assert.deepEqual(store.tryAddPlannedOutOfOffice(vacation("overlap", "U1", "2026-11-28")), planned);
  assert.deepEqual(store.getLastHoMessage()?.hoUsers, []);
  assert.deepEqual(other.getLastHoMessage()?.confirmedOnsiteUsers, ["U2"]);
  assert.equal(store.toggleAttendanceVote(message, "U1", "onsite"), "planned");
  assert.equal(store.toggleAttendanceVote(message, "U2", "onsite"), "updated");
  assert.deepEqual(other.getLastHoMessage()?.confirmedOnsiteUsers, []);

  other.setLastHoMessage({ ...message, messageTs: "987.654" });
  assert.equal(store.toggleAttendanceVote(message, "U2", "ho"), "stale");
  assert.equal(store.getLastHoMessage()?.messageTs, "987.654");
  assert.deepEqual(other.getLastHoMessage()?.hoUsers, []);
});
