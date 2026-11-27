import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VacationAvatarCache } from "../src/vacationAvatars";

const avatarUrl = "https://avatars.slack-edge.com/teammate.png";
const updatedUrl = "https://avatars.slack-edge.com/updated-teammate.png";

function avatarResponse(): Response {
  return new Response("mock avatar", { headers: { "Content-Type": "image/png" } });
}

test("avatar downloads are shared, reused from disk after restart, and refreshed when the URL changes", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "vacation-avatars-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const fetchMock = context.mock.method(globalThis, "fetch", async () => avatarResponse());
  const cache = new VacationAvatarCache(folder);
  const durations: number[] = [];
  const recordDownload = (durationMs: number) => { durations.push(durationMs); };
  const [first, second] = await Promise.all([cache.get(avatarUrl, recordDownload), cache.get(avatarUrl, recordDownload)]);
  assert.match(first ?? "", /^data:image\/png;base64,/);
  assert.equal(first, second);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(durations.length, 1);
  assert.ok(durations[0] >= 0);

  const restarted = new VacationAvatarCache(folder);
  assert.equal(await restarted.get(avatarUrl, recordDownload), first);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(durations.length, 1);
  assert.ok(await restarted.get(updatedUrl));
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("expired avatars refresh and a failed download can be retried", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "vacation-avatars-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  let unavailable = false;
  const fetchMock = context.mock.method(globalThis, "fetch", async () => unavailable ? new Response(null, { status: 503 }) : avatarResponse());
  const cache = new VacationAvatarCache(folder);
  assert.ok(await cache.get(avatarUrl));
  const [file] = await readdir(folder);
  await utimes(join(folder, file), new Date(0), new Date(0));

  unavailable = true;
  assert.equal(await cache.get(avatarUrl), undefined);
  unavailable = false;
  assert.ok(await cache.get(avatarUrl));
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("the local avatar cache keeps at most 128 files", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "vacation-avatars-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  context.mock.method(globalThis, "fetch", async () => avatarResponse());
  const cache = new VacationAvatarCache(folder);
  await Promise.all(Array.from({ length: 130 }, (_, index) => cache.get(`${avatarUrl}?v=${index}`)));
  assert.equal((await readdir(folder)).length, 128);
});
