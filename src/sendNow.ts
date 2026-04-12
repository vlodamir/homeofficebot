import { loadConfig } from "./config";
import { getTomorrowInTimeZone } from "./date";
import { logger } from "./logger";
import { addDefaultReactions, createSlackApp, postHoMessage } from "./slack";
import { StateStore } from "./state";

async function sendNow(): Promise<void> {
  const config = loadConfig();
  const stateStore = new StateStore(config.stateFilePath);

  await stateStore.load();

  const app = createSlackApp(config);
  await app.start();

  const targetDate = getTomorrowInTimeZone(new Date(), config.timezone).isoDate;

  logger.info("Sending HO message now (manual trigger)", { targetDate });

  const trackedMessage = await postHoMessage(app, config.slackChannelId, targetDate);
  await addDefaultReactions(app, trackedMessage.channelId, trackedMessage.messageTs);
  await stateStore.setLastHoMessage(trackedMessage);

  logger.info("Done", { messageTs: trackedMessage.messageTs });

  await app.stop();
  process.exit(0);
}

sendNow().catch((error) => {
  logger.error("sendNow failed", error);
  process.exit(1);
});
