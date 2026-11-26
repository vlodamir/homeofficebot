import test from "node:test";
import assert from "node:assert/strict";
import { buildHoMessageBlocks } from "../src/hoMessage";

test("the daily attendance message still opens Show all with the onsite roster", () => {
  const names = ["Alice :white_check_mark:", "Bob"];
  const blocks = buildHoMessageBlocks("Monday", [], [], names);
  const actions = blocks.find((block) => block.type === "actions")?.elements;
  const showAll = actions?.find((button: { action_id: string }) => button.action_id === "show_all_in_office");
  assert.deepEqual(JSON.parse(showAll?.value), names);
  assert.ok(actions?.some((button: { action_id: string }) => button.action_id === "planned_ooo_button"));
});
