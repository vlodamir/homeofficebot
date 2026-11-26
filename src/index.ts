import { loadConfig } from "./config";
import { logger } from "./logger";
import { publishScheduledHoMessage, startScheduler } from "./scheduler";
import { createSlackApp, registerGlobalErrorHandler, registerButtonHandlers, registerPlannedOOOHandlers, registerAdminHandlers, resolveBotUserId } from "./slack";
import { StateStore } from "./state";
import { getLocalDateInTimeZone } from "./date";
import { AppConfig, RuntimeContext } from "./types";
import { App } from "@slack/bolt";

async function runStartupCatchUp(app: App, config: AppConfig, stateStore: StateStore, runtime: RuntimeContext): Promise<void> {
  const now = new Date();
  const local = getLocalDateInTimeZone(now, config.timezone);
  const localMinutes = local.hour * 60 + local.minute;
  const scheduledMinutes = config.postHour * 60 + config.postMinute;

  if (localMinutes < scheduledMinutes) {
    logger.info("Startup catch-up skipped - scheduled time has not passed yet today");
    return;
  }

  logger.info("Startup catch-up check - scheduled time already passed, checking if message was sent");
  await publishScheduledHoMessage(app, config, stateStore, runtime);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const stateStore = StateStore.open(config.stateDatabasePath, config.stateFilePath);

  const app = createSlackApp(config);
  registerGlobalErrorHandler(app);

  const botUserId = await resolveBotUserId(app);
  const runtime = { botUserId };

  registerButtonHandlers(app, stateStore, runtime, config.timezone, config.vacationCachePrefix);
  registerPlannedOOOHandlers(app, stateStore, runtime, config.timezone);
  registerAdminHandlers(app, stateStore, runtime, config.timezone, config.adminUsers);

  await app.start();
  startScheduler(app, config, stateStore, runtime);
  await runStartupCatchUp(app, config, stateStore, runtime);

  logger.info("Slack HO bot is running", {
    channelId: config.slackChannelId,
    timezone: config.timezone,
    stateDatabasePath: config.stateDatabasePath,
    botUserId,
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
  process.exit(1);
});

main().catch((error) => {
  logger.error("Application failed to start", error);
  process.exit(1);
});
