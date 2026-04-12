import { loadConfig } from "./config";
import { logger } from "./logger";
import { startScheduler } from "./scheduler";
import { createSlackApp, registerGlobalErrorHandler, registerReactionHandlers, resolveBotUserId } from "./slack";
import { StateStore } from "./state";

async function main(): Promise<void> {
  const config = loadConfig();
  const stateStore = new StateStore(config.stateFilePath);

  await stateStore.load();

  const app = createSlackApp(config);
  registerGlobalErrorHandler(app);

  const botUserId = await resolveBotUserId(app);
  const runtime = { botUserId };

  registerReactionHandlers(app, stateStore, runtime);

  await app.start();
  startScheduler(app, config, stateStore, runtime);

  logger.info("Slack HO bot is running", {
    channelId: config.slackChannelId,
    timezone: config.timezone,
    stateFilePath: config.stateFilePath,
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