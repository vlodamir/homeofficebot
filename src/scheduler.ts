import cron, { ScheduledTask } from "node-cron";
import { getCronExpression } from "./config";
import { getTomorrowInTimeZone, isWeekendLocalDateParts } from "./date";
import { logger } from "./logger";
import { StateStore } from "./state";
import { AppConfig, RuntimeContext } from "./types";
import { App } from "@slack/bolt";
import { addDefaultReactions, postHoMessage } from "./slack";

export async function publishScheduledHoMessage(
  app: App,
  config: AppConfig,
  stateStore: StateStore,
  runtime: RuntimeContext,
): Promise<void> {
  const now = new Date();
  const tomorrow = getTomorrowInTimeZone(now, config.timezone);

  if (isWeekendLocalDateParts(tomorrow)) {
    logger.info("Skipping HO message because tomorrow is a weekend", {
      targetDate: tomorrow.isoDate,
    });
    return;
  }

  const targetDate = tomorrow.isoDate;
  const existingMessage = stateStore.getLastHoMessage();

  if (existingMessage?.targetDate === targetDate) {
    logger.warn("Skipping HO message because one already exists for target date", { targetDate });
    return;
  }

  try {
    const trackedMessage = await postHoMessage(app, config.slackChannelId, targetDate);
    await addDefaultReactions(app, trackedMessage.channelId, trackedMessage.messageTs);
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