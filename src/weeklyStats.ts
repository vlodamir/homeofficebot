import cron, { ScheduledTask } from "node-cron";
import { App } from "@slack/bolt";
import { logger } from "./logger";
import { StateStore } from "./state";
import { AppConfig } from "./types";
import { buildWeeklyStatsMessage } from "./hoMessage";
import { getLocalDateInTimeZone, isSaturdayLocalDateParts, getMondayOfWeek } from "./date";

async function resolveUserDisplayName(app: App, userId: string): Promise<string> {
  try {
    const response = await app.client.users.info({ user: userId });
    const profile = response.user?.profile;
    const realName = profile?.real_name?.trim();
    const displayName = profile?.display_name?.trim();
    const username = response.user?.name?.trim();

    return realName || displayName || username || userId;
  } catch (error) {
    logger.warn("Failed to resolve user info, falling back to user ID", { userId, error });
    return userId;
  }
}

export async function publishWeeklyStats(
  app: App,
  config: AppConfig,
  stateStore: StateStore,
): Promise<void> {
  const now = new Date();
  const localDate = getLocalDateInTimeZone(now, config.timezone);

  // Check if today is Saturday
  if (!isSaturdayLocalDateParts(localDate)) {
    logger.debug("Skipping weekly stats - today is not Saturday", {
      date: localDate.isoDate,
    });
    return;
  }

  // Get the week start (Monday) of the week that just ended
  // Since today is Saturday, the Monday of this week is the start of the week we're tallying
  const mondayOfThisWeek = getMondayOfWeek(localDate);

  const weeklyTracking = stateStore.getWeeklyTracking();

  if (!weeklyTracking) {
    logger.info("No weekly tracking data to post", {
      weekStart: mondayOfThisWeek.isoDate,
    });
    return;
  }

  if (weeklyTracking.weekStart !== mondayOfThisWeek.isoDate) {
    logger.info("Weekly tracking is for a different week, skipping", {
      trackedWeek: weeklyTracking.weekStart,
      currentWeekStart: mondayOfThisWeek.isoDate,
    });
    return;
  }

  try {
    // Resolve user IDs to display names
    const userNameCounts: Record<string, number> = {};
    for (const [userId, count] of Object.entries(weeklyTracking.userHoCounts)) {
      const displayName = await resolveUserDisplayName(app, userId);
      userNameCounts[displayName] = count;
    }

    const statsText = buildWeeklyStatsMessage(weeklyTracking.weekStart, userNameCounts);

    const response = await app.client.chat.postMessage({
      channel: config.slackChannelId,
      text: statsText,
    });

    logger.info("Weekly stats posted", {
      channelId: config.slackChannelId,
      messageTs: response.ts,
      weekStart: weeklyTracking.weekStart,
    });

    // Clear the weekly tracking data
    await stateStore.setWeeklyTracking(null);

    logger.info("Weekly tracking data cleared");
  } catch (error) {
    logger.error("Failed to publish weekly stats", error);
  }
}

export function startWeeklyStatsScheduler(
  app: App,
  config: AppConfig,
  stateStore: StateStore,
): ScheduledTask {
  // Schedule for every Saturday at the same time as the daily HO message
  // (usually 18:00 / 6 PM)
  const expression = `${config.postMinute} ${config.postHour} * * 6`; // 6 = Saturday

  const task = cron.schedule(
    expression,
    async () => {
      await publishWeeklyStats(app, config, stateStore);
    },
    {
      timezone: config.timezone,
    },
  );

  logger.info("Weekly stats scheduler started", {
    expression,
    timezone: config.timezone,
  });

  return task;
}
