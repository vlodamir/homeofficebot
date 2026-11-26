import test from "node:test";
import assert from "node:assert/strict";
import { buildShowAllBlocks } from "../src/hoMessage";
import { getLocalDateInTimeZone } from "../src/date";
import { PlannedOutOfOffice } from "../src/types";

test("show all includes only active and upcoming team vacations, soonest first", () => {
  const entries: PlannedOutOfOffice[] = [
    { id: "later", userId: "U2", type: "vacation", startDate: "2026-12-01", endDate: "2026-12-04" },
    { id: "expired", userId: "U3", type: "vacation", startDate: "2026-11-20", endDate: "2026-11-24" },
    { id: "tomorrow", userId: "U1", type: "ho", startDate: "2026-11-26", endDate: "2026-11-26" },
    { id: "ongoing", userId: "U4", type: "vacation", startDate: "2026-11-01" },
    { id: "today", userId: "U5", type: "vacation", startDate: "2026-11-25", endDate: "2026-11-25" },
    { id: "ending", userId: "U6", type: "vacation", startDate: "2026-11-24", endDate: "2026-11-25" },
  ];
  const original = structuredClone(entries);
  const userNames = new Map([
    ["U1", "Alice"], ["U2", "Bob"], ["U3", "Carol"],
    ["U4", "David"], ["U5", "Eve"], ["U6", "Frank"],
  ]);
  const blocks = buildShowAllBlocks(["Alice :white_check_mark:"], entries, "2026-11-25", userNames);
  const texts = blocks.filter((block) => block.type === "section").map((block) => block.text.text);

  assert.deepEqual(texts, [
    "• Alice :white_check_mark:",
    [
      "• David\n  2026-11-01 → No end date · Ongoing",
      "• Frank\n  2026-11-24 → 2026-11-25 · Ongoing",
      "• Eve\n  2026-11-25 → 2026-11-25 · Starts today",
      "• Bob\n  2026-12-01 → 2026-12-04 · Starts in 6 days",
    ].join("\n"),
  ]);
  assert.deepEqual(entries, original);
});

test("show all provides empty states when the team has only home office plans and nobody onsite", () => {
  const entries: PlannedOutOfOffice[] = [{ id: "ongoing-ho", userId: "U1", type: "ho", startDate: "2026-11-24" }];
  const blocks = buildShowAllBlocks([], entries, "2026-11-25");
  const texts = blocks.filter((block) => block.type === "section").map((block) => block.text.text);
  assert.deepEqual(texts, ["No teammates onsite.", "No current or upcoming team vacations."]);
});

test("countdowns use local calendar dates across midnight, DST, and year boundaries", () => {
  for (const [now, startDate, expected] of [
    ["2026-11-24T23:30:00Z", "2026-11-25", "Starts today"],
    ["2026-03-28T12:00:00Z", "2026-03-30", "Starts in 2 days"],
    ["2026-10-24T12:00:00Z", "2026-10-26", "Starts in 2 days"],
    ["2026-12-31T12:00:00Z", "2027-01-01", "Starts in 1 day"],
  ]) {
    const today = getLocalDateInTimeZone(new Date(now), "Europe/Prague").isoDate;
    const blocks = buildShowAllBlocks([], [{ id: "plan", userId: "U1", type: "vacation", startDate }], today);
    assert.ok(blocks.some((block) => block.text?.text.endsWith(expected)), now);
  }
});

test("long team vacation lists are split without dropping entries", () => {
  const entries: PlannedOutOfOffice[] = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), userId: `U${index}`, type: "vacation", startDate: "2026-12-01", endDate: "2026-12-10",
  }));
  const blocks = buildShowAllBlocks([], entries, "2026-11-25");
  const sections = blocks.filter((block) => block.type === "section");
  assert.ok(sections.every((block) => block.text.text.length > 0 && block.text.text.length <= 3000));
  assert.equal(sections.map((block) => block.text.text).join("\n").match(/^• U\d+$/gm)?.length, 100);
});
