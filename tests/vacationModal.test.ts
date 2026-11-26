import test from "node:test";
import assert from "node:assert/strict";
import type { App, types } from "@slack/bolt";
import { getLocalDateInTimeZone } from "../src/date";
import { PlannedOutOfOffice } from "../src/types";
import { registerVacationModal } from "../src/vacationModal";

const timezone = "Europe/Prague";
const privateUrl = "https://files.slack.com/files-pri/T1-F1/vacation-timeline.png";

interface ViewRequest {
  view: types.ModalView;
  hash?: string;
  view_id?: string;
}

interface ActionRequest {
  ack: () => Promise<void>;
  action: { action_id: string; value?: string };
  body: { trigger_id: string; user: { id: string }; team: { id: string }; view?: types.ModalView & { id: string; hash: string } };
}

function slackError(error: string, messages?: string[]) {
  return Object.assign(new Error(error), { data: { error, response_metadata: { messages } } });
}

function testSlack(entries: PlannedOutOfOffice[], options: { rejectUpload?: boolean; rejectImage?: boolean; delayFileMetadata?: boolean } = {}) {
  const handlers = new Map<RegExp | string, (request: ActionRequest) => Promise<void>>();
  const events: string[] = [];
  let currentHash = "hash0";
  let revision = 0;
  let fileLookups = 0;
  const opened: types.ModalView[] = [];
  const updates: ViewRequest[] = [];
  const app = {
    action: (id: RegExp | string, handler: (request: ActionRequest) => Promise<void>) => handlers.set(id, handler),
    client: {
      files: {
        getUploadURLExternal: async () => {
          events.push("allocate");
          if (options.rejectUpload) throw slackError("missing_scope");
          return { ok: true, file_id: "F1", upload_url: "data:text/plain,ok" };
        },
        completeUploadExternal: async () => ({ ok: true, files: [{ id: "F1" }] }),
        info: async () => {
          fileLookups++;
          const url = options.delayFileMetadata && fileLookups === 1 ? undefined : privateUrl;
          return { ok: true, file: { id: "F1", is_public: false, url_private: url } };
        },
      },
      views: {
        open: async ({ view }: ViewRequest) => {
          events.push("open");
          opened.push(view);
          assert.ok(JSON.stringify(view).includes("Loading planned vacations"));
          return { view: { id: "V1", hash: currentHash } };
        },
        update: async (request: ViewRequest) => {
          events.push("update");
          assert.equal(request.view_id, "V1");
          if (request.hash !== currentHash) throw slackError("hash_conflict");
          updates.push(request);
          const image = request.view.blocks.find((block) => block.type === "image");
          if (options.rejectImage && image) throw slackError("invalid_arguments");
          if (options.delayFileMetadata && image && "slack_file" in image &&
              JSON.stringify(image.slack_file) === '{"id":"F1"}') {
            throw slackError("invalid_arguments", ["[ERROR] invalid slack file [json-pointer:view/blocks/3/slack_file.id/slack_file]"]);
          }
          currentHash = `hash${++revision}`;
          return { view: { id: "V1", hash: currentHash } };
        },
      },
    },
  };
  registerVacationModal(app as unknown as App, { getPlannedOutOfOffice: () => entries }, timezone, "B1", async () => ({ name: "Jana" }));

  async function click(actionId: string, view?: ActionRequest["body"]["view"]) {
    const match = [...handlers].find(([id]) => typeof id === "string" ? id === actionId : id.test(actionId));
    assert.ok(match);
    await match[1]({
      ack: async () => { events.push("ack"); },
      action: { action_id: actionId, value: '["Mirek :white_check_mark:"]' },
      body: { trigger_id: "trigger", user: { id: "U1" }, team: { id: "T1" }, view },
    });
  }

  function sourceView(month: string): NonNullable<ActionRequest["body"]["view"]> {
    return {
      type: "modal", title: { type: "plain_text", text: "Planned vacations" }, blocks: [],
      id: "V1", hash: currentHash, callback_id: "show_all_modal",
      private_metadata: JSON.stringify({ month, onsite: [], workspace: "T1" }),
    };
  }
  return { click, sourceView, events, opened, updates };
}

function todayVacation(): PlannedOutOfOffice {
  const date = getLocalDateInTimeZone(new Date(), timezone).isoDate;
  return { id: "vacation", type: "vacation", userId: "U1", startDate: date, endDate: date };
}

test("Show all displays the onsite roster first while loading and after the private image is uploaded", async () => {
  const slack = testSlack([todayVacation()]);
  await slack.click("show_all_in_office");
  assert.deepEqual(slack.events, ["ack", "open", "allocate", "update"]);
  const [update] = slack.updates;
  assert.equal(update.hash, "hash0");
  assert.equal(update.view.title.text, "🏝️ Planned vacations");
  const onsite = [
    { type: "header", text: { type: "plain_text", text: "Onsite" } },
    { type: "section", text: { type: "mrkdwn", text: "• Mirek :white_check_mark:" } },
    { type: "divider" },
  ];
  assert.deepEqual(slack.opened[0]?.blocks.slice(0, onsite.length), onsite);
  assert.deepEqual(update.view.blocks.slice(0, onsite.length), onsite);
  const [month, navigation] = update.view.blocks.slice(onsite.length);
  assert.ok(month.type === "section" && "accessory" in month);
  assert.deepEqual(month.accessory, {
    type: "button", text: { type: "plain_text", text: "Today" }, action_id: "vacation_month_today",
  });
  assert.ok(navigation.type === "actions" && "elements" in navigation);
  assert.deepEqual(navigation.elements, [
    { type: "button", text: { type: "plain_text", text: "← Previous" }, action_id: "vacation_month_previous" },
    { type: "button", text: { type: "plain_text", text: "Next →" }, action_id: "vacation_month_next" },
  ]);
  const image = update.view.blocks.find((block) => block.type === "image");
  assert.ok(image && "slack_file" in image);
  assert.deepEqual(image.slack_file, { url: privateUrl });
  assert.doesNotMatch(JSON.stringify(update.view.blocks), /planned_ooo_button/);
});

test("Slack file validation errors retry with refreshed private metadata in the existing modal", async () => {
  const slack = testSlack([todayVacation()], { delayFileMetadata: true });
  await slack.click("show_all_in_office");
  assert.deepEqual(slack.events, ["ack", "open", "allocate", "update", "update"]);
  assert.deepEqual(slack.updates.map((request) => request.hash), ["hash0", "hash0"]);
  const references = slack.updates.map(({ view }) => {
    const image = view.blocks.find((block) => block.type === "image");
    assert.ok(image && "slack_file" in image);
    return image.slack_file;
  });
  assert.deepEqual(references, [{ id: "F1" }, { url: privateUrl }]);
});

test("navigation updates the same modal and stale clicks cannot overwrite a newer view", async () => {
  const slack = testSlack([]);
  const oldView = slack.sourceView("2026-12");
  await Promise.all([slack.click("vacation_month_next", oldView), slack.click("vacation_month_previous", oldView)]);
  assert.deepEqual(slack.updates.map((request) => JSON.parse(request.view.private_metadata ?? "{}").month), ["2027-01", "2027-01"]);
  assert.deepEqual(slack.updates.map(({ hash }) => hash), ["hash0", "hash1"]);
  assert.ok(JSON.stringify(slack.updates[1].view.blocks).includes("No vacations scheduled this month."));

  await slack.click("vacation_month_previous", slack.sourceView("2027-01"));
  assert.equal(JSON.parse(slack.updates[3].view.private_metadata ?? "{}").month, "2026-12");
  await slack.click("vacation_month_today", slack.sourceView("2026-12"));
  assert.equal(JSON.parse(slack.updates[5].view.private_metadata ?? "{}").month, getLocalDateInTimeZone(new Date(), timezone).isoDate.slice(0, 7));
  assert.ok(!slack.events.includes("open"));
  assert.ok(!slack.events.includes("allocate"));
});

test("upload and image modal update failures leave a usable date list and navigation", async () => {
  const entry = todayVacation();
  for (const options of [{ rejectUpload: true }, { rejectImage: true }]) {
    const slack = testSlack([entry], options);
    await slack.click("show_all_in_office");
    const fallback = slack.updates.at(-1)?.view;
    assert.ok(fallback);
    assert.ok(!fallback.blocks.some((block) => block.type === "image"));
    const text = JSON.stringify(fallback.blocks);
    assert.ok(text.includes(`Jana · ${entry.startDate}`));
    assert.ok(text.includes("vacation_month_today"));
    assert.equal(slack.updates.length, options.rejectImage ? 2 : 1);
  }
});
