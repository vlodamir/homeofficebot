import cron, { ScheduledTask } from "node-cron";
import { getCronExpression } from "./config";
import { getLocalDateInTimeZone, getNextWorkdayInTimeZone, isWeekendLocalDateParts } from "./date";
import { logger } from "./logger";
import { StateStore } from "./state";
import { AppConfig, RuntimeContext } from "./types";
import { App } from "@slack/bolt";
import { postHoMessage } from "./slack";

export async function publishScheduledHoMessage(
  app: App,
  config: AppConfig,
  stateStore: StateStore,
  runtime: RuntimeContext,
): Promise<void> {
  const now = new Date();
  const today = getLocalDateInTimeZone(now, config.timezone);

  if (isWeekendLocalDateParts(today)) {
    logger.info("Skipping HO message because today is a weekend", {
      localDate: today.isoDate,
    });
    return;
  }

  const targetDate = getNextWorkdayInTimeZone(now, config.timezone).isoDate;
  const existingMessage = stateStore.getLastHoMessage();

  if (existingMessage?.targetDate === targetDate) {
    logger.warn("Skipping HO message because one already exists for target date", { targetDate });
    return;
  }

  try {
    const trackedMessage = await postHoMessage(app, config.slackChannelId, targetDate, config.teamMembers, stateStore);
    await stateStore.setLastHoMessage(trackedMessage);

    logger.info("Scheduled HO message published", {
      targetDate,
      channelId: trackedMessage.channelId,
      messageTs: trackedMessage.messageTs,
      botUserId: runtime.botUserId,
    });
  } catch (error) {
    logger.error("Failed to publish scheduled HO message", error);
  }
}

export function startScheduler(
  app: App,
  config: AppConfig,
  stateStore: StateStore,
  runtime: RuntimeContext,
): ScheduledTask {
  const expression = getCronExpression(config);

  const task = cron.schedule(
    expression,
    async () => {
      await publishScheduledHoMessage(app, config, stateStore, runtime);
    },
    {
      timezone: config.timezone,
    },
  );

  logger.info("Scheduler started", {
    expression,
    timezone: config.timezone,
  });

  return task;
}
