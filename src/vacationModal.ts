import type { App, BlockAction, ButtonAction, types } from "@slack/bolt";
import { setTimeout as delay } from "node:timers/promises";
import { getLocalDateInTimeZone } from "./date";
import { logger } from "./logger";
import type { StateStore } from "./state";
import { VacationAvatarCache } from "./vacationAvatars";
import { buildVacationMonth, shiftVacationMonth, VacationMonth } from "./vacationMonth";
import { isSlackFileReferenceRejected, slackErrorCode, slackVacationImageFiles, VacationImageCache, vacationImageKey, VacationSlackImage } from "./vacationImages";
import { renderVacationTimeline, VacationProfile } from "./vacationTimeline";

const callbackId = "show_all_modal";
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const imageRetryDelay = 1000;

type SlackImageReference = NonNullable<types.SlackFileImageObject["slack_file"]>;

interface VacationViewMetadata {
  month: string;
  onsite: string[];
  workspace: string;
}

function plain(text: string): types.PlainTextElement {
  return { type: "plain_text", text };
}

function section(text: string): types.SectionBlock {
  return { type: "section", text: plain(text) };
}

function listSections(lines: string[], markdown = false): types.SectionBlock[] {
  const chunks: string[] = [];
  for (const line of lines) {
    const previous = chunks[chunks.length - 1];
    if (previous && previous.length + line.length + 1 <= 2900) {
      chunks[chunks.length - 1] += `\n${line}`;
    } else {
      chunks.push(line.slice(0, 2900));
    }
  }
  return chunks.map((text) => markdown ? { type: "section", text: { type: "mrkdwn", text } } : section(text));
}

function monthNavigation(text: types.TextObject): types.KnownBlock[] {
  return [
    {
      type: "section",
      text,
      accessory: { type: "button", text: plain("Today"), action_id: "vacation_month_today" },
    },
    {
      type: "actions",
      elements: [
        { type: "button", text: plain("← Previous"), action_id: "vacation_month_previous" },
        { type: "button", text: plain("Next →"), action_id: "vacation_month_next" },
      ],
    },
  ];
}

function vacationView(metadata: VacationViewMetadata, blocks: types.KnownBlock[]): types.ModalView {
  const onsite = metadata.onsite.map((name) => `• ${name}`);
  return {
    type: "modal",
    callback_id: callbackId,
    private_metadata: JSON.stringify(metadata),
    title: plain("🏝️ Planned vacations"),
    blocks: [
      { type: "header", text: plain("Onsite") },
      ...listSections(onsite.length ? onsite : ["No teammates onsite."], true),
      { type: "divider" },
      ...blocks,
    ],
  };
}

function loadingView(metadata: VacationViewMetadata): types.ModalView {
  return vacationView(metadata, monthNavigation(plain("Loading planned vacations…")));
}

function monthView(
  metadata: VacationViewMetadata,
  month: VacationMonth,
  profiles: ReadonlyMap<string, VacationProfile>,
  image?: SlackImageReference,
): types.ModalView {
  const count = month.vacations.length;
  const employees = month.employees.length;
  const summary = `${count} ${count === 1 ? "vacation" : "vacations"} · ${employees} ${employees === 1 ? "employee" : "employees"}`;
  const blocks = monthNavigation({ type: "mrkdwn", text: `*${month.label}*\n${summary}` });

  if (image) {
    blocks.push({
      type: "image",
      slack_file: image,
      alt_text: `Vacation timeline for ${month.label}. ${summary}. Pink marks Czech public holidays, gray marks weekends, and amber marks days with two or more employees away. Exact vacation dates are listed below.`,
    });
  } else if (count > 0) {
    blocks.push(section("The timeline image is unavailable. Vacation dates are listed below."));
  } else {
    blocks.push(section("No vacations scheduled this month."));
  }

  const overlapDays = month.days.filter(({ away }) => away > 1);
  if (overlapDays.length > 0) {
    const peak = Math.max(...overlapDays.map(({ away }) => away));
    const dayLabel = overlapDays.length === 1 ? "day" : "days";
    blocks.push(section(`Vacations overlap on ${overlapDays.length} ${dayLabel}. Up to ${peak} employees are away together.`));
  }
  if (count > 0) {
    const lines = month.vacations.map(({ userId, startDate, endDate }) => {
      const name = (profiles.get(userId)?.name || userId).replace(/\s+/g, " ");
      const dateRange = startDate === endDate ? startDate : `${startDate} → ${endDate || "No end date"}`;
      return `• ${name} · ${dateRange}`;
    });
    blocks.push(...listSections(lines));
  }
  return vacationView(metadata, blocks);
}

function readOnsite(value?: string): string[] {
  try {
    const names: unknown = JSON.parse(value ?? "[]");
    if (Array.isArray(names)) return names.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
  return [];
}

function isStaleView(error: unknown): boolean {
  const code = slackErrorCode(error);
  return code === "hash_conflict" || code === "view_not_found";
}

export function registerVacationModal(
  app: App,
  stateStore: Pick<StateStore, "getVacationsInRange">,
  timezone: string,
  botUserId: string,
  getProfile: (userId: string) => Promise<VacationProfile>,
  vacationCachePrefix?: string,
): void {
  const cachePrefix = vacationCachePrefix && `${vacationCachePrefix}.${botUserId}`;
  const files = slackVacationImageFiles(app.client.files);
  const cache = new VacationImageCache(files, cachePrefix && `${cachePrefix}.vacation-images.json`);
  const avatars = new VacationAvatarCache(cachePrefix && `${cachePrefix}.vacation-avatars`);

  async function showMonth(viewId: string, hash: string, metadata: VacationViewMetadata, today: string) {
    const start = `${metadata.month}-01`;
    const end = `${shiftVacationMonth(metadata.month, 1)}-01`;
    const entries = stateStore.getVacationsInRange(start, end);
    const month = buildVacationMonth(metadata.month, today, entries);
    const profiles = new Map(await Promise.all(month.employees.map(async ({ userId }) =>
      [userId, await getProfile(userId)] as const,
    )));
    let file: VacationSlackImage | undefined;
    if (month.employees.length > 0) {
      try {
        const key = vacationImageKey(metadata.workspace, botUserId, month, profiles);
        file = await cache.get(key, month.month, () => renderVacationTimeline(month, profiles, avatars));
      } catch (error) {
        logger.warn("Could not prepare the vacation timeline image", { slackError: slackErrorCode(error) });
      }
    }

    const update = (image?: SlackImageReference) => app.client.views.update({
      view_id: viewId,
      hash,
      view: monthView(metadata, month, profiles, image),
    });
    const image = file?.privateUrl ? { url: file.privateUrl } : file ? { id: file.id } : undefined;
    try {
      await update(image);
    } catch (error) {
      if (isStaleView(error)) return;
      let failure = error;
      if (file && isSlackFileReferenceRejected(error)) {
        try {
          await delay(imageRetryDelay);
          // Try the other private reference when Slack has finished indexing the upload.
          const refreshed = file.privateUrl ? undefined : await files.getReference(file.id).catch(() => undefined);
          await update(refreshed?.privateUrl ? { url: refreshed.privateUrl } : { id: file.id });
          return;
        } catch (retryError) {
          if (isStaleView(retryError)) return;
          failure = retryError;
        }
      }
      logger.warn("Could not update the vacation modal, retrying with vacation dates", { slackError: slackErrorCode(failure) });
      await update();
    }
  }

  app.action<BlockAction<ButtonAction>>("show_all_in_office", async ({ ack, action, body }) => {
    await ack();
    const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
    const metadata = {
      month: today.slice(0, 7),
      onsite: readOnsite(action.value),
      workspace: body.team?.id ?? body.user.team_id ?? body.api_app_id,
    };
    try {
      const { view } = await app.client.views.open({ trigger_id: body.trigger_id, view: loadingView(metadata) });
      if (view?.id && view.hash) await showMonth(view.id, view.hash, metadata, today);
    } catch (error) {
      if (!isStaleView(error)) logger.warn("Could not open the vacation modal", { slackError: slackErrorCode(error) });
    }
  });

  app.action<BlockAction<ButtonAction>>(/^vacation_month_(previous|today|next)$/, async ({ ack, action, body }) => {
    await ack();
    if (body.view?.callback_id !== callbackId || !body.view.hash) return;
    const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
    try {
      const metadata = JSON.parse(body.view.private_metadata) as VacationViewMetadata;
      if (!monthPattern.test(metadata.month)) return;
      const month = action.action_id === "vacation_month_today"
        ? today.slice(0, 7)
        : shiftVacationMonth(metadata.month, action.action_id === "vacation_month_previous" ? -1 : 1);
      const selection = { ...metadata, month };
      const { view } = await app.client.views.update({
        view_id: body.view.id,
        hash: body.view.hash,
        view: loadingView(selection),
      });
      if (view?.hash) await showMonth(body.view.id, view.hash, selection, today);
    } catch (error) {
      if (!isStaleView(error)) logger.warn("Could not change the vacation month", { slackError: slackErrorCode(error) });
    }
  });
}
