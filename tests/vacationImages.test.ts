import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVacationMonth } from "../src/vacationMonth";
import { slackVacationImageFiles, VacationImageCache, vacationImageKey } from "../src/vacationImages";
import { PlannedOutOfOffice } from "../src/types";

const png = Buffer.from([137, 80, 78, 71]);

test("the image cache deduplicates concurrent requests, survives restart, and replaces deleted files", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "vacation-images-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, "images.json");
  const activeFiles = new Set<string>();
  let uploadCount = 0;
  const files = {
    getReference: async (id: string) => activeFiles.has(id) ? { id } : undefined,
    upload: async () => {
      const id = `F${++uploadCount}`;
      activeFiles.add(id);
      return id;
    },
    remove: async (id: string) => { activeFiles.delete(id); },
  };
  const cache = new VacationImageCache(files, path);
  const render = async () => png;
  assert.deepEqual(await Promise.all([
    cache.get("key", "2026-11", render), cache.get("key", "2026-11", render),
  ]), [{ id: "F1" }, { id: "F1" }]);

  const restarted = new VacationImageCache(files, path);
  assert.deepEqual(await restarted.get("key", "2026-11", render), { id: "F1" });
  activeFiles.delete("F1");
  assert.deepEqual(await restarted.get("key", "2026-11", render), { id: "F2" });
  assert.equal(uploadCount, 2);
});

test("the image cache caps uploads and cleans up expired files", async () => {
  const activeFiles = new Set<string>();
  let uploadCount = 0;
  let now = 0;
  const cache = new VacationImageCache({
    getReference: async (id) => activeFiles.has(id) ? { id } : undefined,
    upload: async () => {
      const id = `F${++uploadCount}`;
      activeFiles.add(id);
      return id;
    },
    remove: async (id) => { activeFiles.delete(id); },
  }, undefined, () => now);
  for (let index = 0; index < 27; index++) await cache.get(String(index), "2026-11", async () => png);
  assert.equal(activeFiles.size, 24);
  assert.ok(!activeFiles.has("F1"));
  now += 24 * 60 * 60 * 1000;
  assert.deepEqual(await cache.get("26", "2026-11", async () => png), { id: "F28" });
  assert.deepEqual([...activeFiles], ["F28"]);
});

test("the image key changes when relevant vacations, the date marker, or file access identity change", () => {
  const entry: PlannedOutOfOffice = {
    id: "entry", userId: "U1", type: "vacation", startDate: "2026-11-26", endDate: "2026-11-26",
  };
  const key = (entries: PlannedOutOfOffice[], workspace = "T1", bot = "BOT1", today = "2026-11-26") =>
    vacationImageKey(workspace, bot, buildVacationMonth("2026-11", today, entries), new Map());
  const original = key([entry]);
  assert.notEqual(original, key([]));
  assert.notEqual(original, key([{ ...entry, endDate: "2026-11-29" }]));
  assert.notEqual(original, key([entry, { ...entry, id: "another", userId: "U2" }]));
  assert.notEqual(original, key([entry], "T2"));
  assert.notEqual(original, key([entry], "T1", "BOT2"));
  assert.notEqual(original, key([entry], "T1", "BOT1", "2026-11-27"));
  assert.equal(original, key([entry, { ...entry, id: "ho", type: "ho" }]));
});

test("Slack uploads PNG bytes through the external upload flow and completes without sharing", async () => {
  const uploadUrl = "https://files.slack.com/upload/v1/mock";
  const privateUrl = "https://files.slack.com/files-pri/T1-F1/vacation-timeline-2026-11.png";
  const steps: string[] = [];
  const files = slackVacationImageFiles({
    info: async () => ({ ok: true, file: { id: "F1", is_public: false, url_private: privateUrl } }),
    delete: async () => ({ ok: true }),
    getUploadURLExternal: async (args) => {
      steps.push("allocate");
      assert.deepEqual(args, { filename: "vacation-timeline-2026-11.png", length: png.length });
      return { ok: true, file_id: "F1", upload_url: uploadUrl };
    },
    completeUploadExternal: async (args) => {
      steps.push("complete");
      assert.deepEqual(args, { files: [{ id: "F1", title: "Vacation timeline 2026-11" }] });
      return { ok: true, files: [{ id: "F1" }] };
    },
  }, async (url, init) => {
    steps.push("upload");
    assert.equal(url, uploadUrl);
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.body, new Uint8Array(png));
    return new Response("OK");
  });
  assert.equal(await files.upload("2026-11", png), "F1");
  assert.deepEqual(await files.getReference("F1"), { id: "F1", privateUrl });
  assert.deepEqual(steps, ["allocate", "upload", "complete"]);
});

test("failed byte uploads skip completion and failed completion attempts clean up", async () => {
  const steps: string[] = [];
  let uploadStatus = 502;
  const files = slackVacationImageFiles({
    info: async () => ({ ok: true }),
    delete: async ({ file }) => { steps.push(`delete ${file}`); return { ok: true }; },
    getUploadURLExternal: async () => ({ ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/v1/mock" }),
    completeUploadExternal: async () => { steps.push("complete"); throw new Error("Slack completion failed"); },
  }, async () => new Response("mock", { status: uploadStatus }));
  await assert.rejects(files.upload("2026-11", png), /HTTP 502/);
  assert.deepEqual(steps, []);
  uploadStatus = 200;
  await assert.rejects(files.upload("2026-11", png), /Slack completion failed/);
  assert.deepEqual(steps, ["complete", "delete F1"]);
});
