import { loadConfig } from "./config";
import { getNextWorkdayInTimeZone } from "./date";
import { logger } from "./logger";
import { createSlackApp, postHoMessage } from "./slack";
import { StateStore } from "./state";

async function sendNow(): Promise<void> {
  const config = loadConfig();
  const stateStore = StateStore.open(config.stateDatabasePath, config.stateFilePath);
  try {
    const app = createSlackApp(config);
    await app.start();

    const targetDate = getNextWorkdayInTimeZone(new Date(), config.timezone).isoDate;
    logger.info("Sending HO message now (manual trigger)", { targetDate });

    const trackedMessage = await postHoMessage(app, config.slackChannelId, targetDate, stateStore.getTeamMembers(), stateStore);
    stateStore.setLastHoMessage(trackedMessage);

    logger.info("Done", { messageTs: trackedMessage.messageTs });
    await app.stop();
  } finally {
    stateStore.close();
  }
  process.exit(0);
}

sendNow().catch((error) => {
  logger.error("sendNow failed", error);
  process.exit(1);
});
