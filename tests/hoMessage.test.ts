import test from "node:test";
import assert from "node:assert/strict";
import { buildShowAllBlocks } from "../src/hoMessage";
import { getLocalDateInTimeZone } from "../src/date";
import { PlannedOutOfOffice } from "../src/types";

test("show all includes the whole team's active and future plans, soonest first", () => {
  const entries: PlannedOutOfOffice[] = [
    { id: "later", userId: "U2", type: "vacation", startDate: "2026-12-01", endDate: "2026-12-04" },
    { id: "expired", userId: "U3", type: "vacation", startDate: "2026-11-20", endDate: "2026-11-24" },
    { id: "tomorrow", userId: "U1", type: "ho", startDate: "2026-11-26", endDate: "2026-11-26" },
    { id: "ongoing", userId: "U4", type: "ho", startDate: "2026-11-01" },
    { id: "today", userId: "U5", type: "vacation", startDate: "2026-11-25", endDate: "2026-11-25" },
    { id: "ending", userId: "U6", type: "vacation", startDate: "2026-11-24", endDate: "2026-11-25" },
  ];
  const original = structuredClone(entries);
  const userNames = new Map([
    ["U1", "Alice"], ["U2", "Bob"], ["U3", "Carol"],
    ["U4", "David"], ["U5", "Eve"], ["U6", "Frank"],
  ]);
  const blocks = buildShowAllBlocks(["Alice :white_check_mark:"], entries, "2026-11-25", userNames);
  const text = blocks.map((block) => block.text?.text || "").join("\n");

  assert.match(text, /Alice :white_check_mark:/);
  assert.deepEqual([...text.matchAll(/• (\w+) —/g)].map((match) => match[1]), ["David", "Frank", "Eve", "Alice", "Bob"]);
  assert.doesNotMatch(text, /<@/);
  assert.match(text, /Home Office\n  2026-11-01 → No end date · Ongoing/);
  assert.match(text, /2026-11-25 → 2026-11-25 · Starts today/);
  assert.match(text, /2026-11-26 → 2026-11-26 · Starts in 1 day\b/);
  assert.match(text, /Vacation\n  2026-12-01 → 2026-12-04 · Starts in 6 days/);
  assert.deepEqual(entries, original);
});

test("show all provides empty states for both sections", () => {
  const blocks = buildShowAllBlocks([], [], "2026-11-25");
  const texts = blocks.filter((block) => block.type === "section").map((block) => block.text.text);
  assert.deepEqual(texts, ["No teammates onsite.", "No planned absences for the team."]);
});

test("countdowns use local calendar dates across midnight, DST, and year boundaries", () => {
  for (const [now, startDate, expected] of [
    ["2026-11-24T23:30:00Z", "2026-11-25", "Starts today"],
    ["2026-03-28T12:00:00Z", "2026-03-30", "Starts in 2 days"],
    ["2026-10-24T12:00:00Z", "2026-10-26", "Starts in 2 days"],
    ["2026-12-31T12:00:00Z", "2027-01-01", "Starts in 1 day"],
  ]) {
    const today = getLocalDateInTimeZone(new Date(now), "Europe/Prague").isoDate;
    const blocks = buildShowAllBlocks([], [{ id: "plan", userId: "U1", type: "ho", startDate }], today);
    assert.ok(blocks.some((block) => block.text?.text.endsWith(expected)), now);
  }
});

test("long team absence lists are split without dropping entries", () => {
  const entries: PlannedOutOfOffice[] = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), userId: `U${index}`, type: "vacation", startDate: "2026-12-01", endDate: "2026-12-10",
  }));
  const blocks = buildShowAllBlocks([], entries, "2026-11-25");
  const sections = blocks.filter((block) => block.type === "section");
  assert.ok(sections.every((block) => block.text.text.length > 0 && block.text.text.length <= 3000));
  assert.equal(sections.map((block) => block.text.text).join("\n").match(/• U\d+ —/g)?.length, 100);
});
