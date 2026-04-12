import { App } from "@slack/bolt";
import { buildHoMessageText } from "./hoMessage";
import { logger } from "./logger";
import { StateStore } from "./state";
import { AppConfig, HOMessageState, RuntimeContext } from "./types";
import { getCzechWeekdayNameFromIso } from "./date";

interface SlackReaction {
  name?: string;
  users?: string[];
  count?: number;
}

interface SlackMessage {
  ts?: string;
  text?: string;
  reactions?: SlackReaction[];
}

const POSITIVE_REACTION = "white_check_mark";

function isKnownSlackError(error: unknown): error is { data?: { error?: string } } {
  return typeof error === "object" && error !== null;
}

export function createSlackApp(config: AppConfig): App {
  return new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });
}

export async function resolveBotUserId(app: App): Promise<string> {
  const response = await app.client.auth.test();

  if (!response.user_id) {
    throw new Error("Unable to resolve bot user ID");
  }

  return response.user_id;
}

export async function postHoMessage(app: App, channelId: string, targetDate: string): Promise<HOMessageState> {
  const dayName = getCzechWeekdayNameFromIso(targetDate);
  const text = buildHoMessageText(dayName, []);

  const response = await app.client.chat.postMessage({
    channel: channelId,
    text,
  });

  if (!response.ts || !response.channel) {
    throw new Error("Slack did not return message timestamp or channel ID");
  }

  return {
    channelId: response.channel,
    messageTs: response.ts,
    targetDate,
    postedAt: new Date().toISOString(),
  };
}

export async function addDefaultReactions(app: App, channelId: string, messageTs: string): Promise<void> {
  await addReactionIfPossible(app, channelId, messageTs, POSITIVE_REACTION);
}

async function removeBotReactionIfPresent(app: App, channelId: string, messageTs: string): Promise<void> {
  try {
    await app.client.reactions.remove({
      channel: channelId,
      timestamp: messageTs,
      name: POSITIVE_REACTION,
    });
  } catch (error) {
    if (isKnownSlackError(error) && error.data?.error === "no_reaction") {
      return;
    }
    logger.warn("Failed to remove bot reaction", { error });
  }
}

async function addReactionIfPossible(app: App, channelId: string, messageTs: string, reaction: string): Promise<void> {
  try {
    await app.client.reactions.add({
      channel: channelId,
      timestamp: messageTs,
      name: reaction,
    });
  } catch (error) {
    if (isKnownSlackError(error) && error.data?.error === "already_reacted") {
      logger.warn("Reaction already exists on message", { channelId, messageTs, reaction });
      return;
    }

    throw error;
  }
}

export async function fetchTrackedMessage(app: App, channelId: string, messageTs: string): Promise<SlackMessage | null> {
  const response = await app.client.conversations.history({
    channel: channelId,
    inclusive: true,
    latest: messageTs,
    oldest: messageTs,
    limit: 1,
  });

  const message = response.messages?.find((item) => item.ts === messageTs) ?? null;
  return message;
}

async function resolveUserDisplayName(app: App, userId: string): Promise<string> {
  try {
    const response = await app.client.users.info({ user: userId });
    const profile = response.user?.profile;
    const displayName = profile?.display_name?.trim();
    const realName = profile?.real_name?.trim();
    const username = response.user?.name?.trim();

    return displayName || realName || username || userId;
  } catch (error) {
    logger.warn("Failed to resolve user info, falling back to user ID", { userId, error });
    return userId;
  }
}

export async function getApprovedUsers(app: App, message: SlackMessage, botUserId: string): Promise<string[]> {
  const users =
    message.reactions?.find((reaction) => reaction.name === POSITIVE_REACTION)?.users?.filter((userId) => userId !== botUserId) ?? [];

  const uniqueUsers = Array.from(new Set(users));
  const names = await Promise.all(uniqueUsers.map((userId) => resolveUserDisplayName(app, userId)));

  return names.sort((left, right) => left.localeCompare(right, "cs"));
}

export async function syncTrackedHoMessage(app: App, stateStore: StateStore, runtime: RuntimeContext): Promise<void> {
  const trackedMessage = stateStore.getLastHoMessage();

  if (!trackedMessage) {
    logger.info("No tracked HO message in state, skipping sync");
    return;
  }

  const message = await fetchTrackedMessage(app, trackedMessage.channelId, trackedMessage.messageTs);

  if (!message) {
    logger.warn("Tracked HO message was not found on Slack", trackedMessage);
    return;
  }

  const approvedUsers = await getApprovedUsers(app, message, runtime.botUserId);
  const updatedText = buildHoMessageText(getCzechWeekdayNameFromIso(trackedMessage.targetDate), approvedUsers);

  await app.client.chat.update({
    channel: trackedMessage.channelId,
    ts: trackedMessage.messageTs,
    text: updatedText,
  });

  if (approvedUsers.length > 0) {
    await removeBotReactionIfPresent(app, trackedMessage.channelId, trackedMessage.messageTs);
  } else {
    await addReactionIfPossible(app, trackedMessage.channelId, trackedMessage.messageTs, POSITIVE_REACTION);
  }

  logger.info("Tracked HO message synchronized", {
    channelId: trackedMessage.channelId,
    messageTs: trackedMessage.messageTs,
    approvedUsersCount: approvedUsers.length,
  });
}

export function registerReactionHandlers(app: App, stateStore: StateStore, runtime: RuntimeContext): void {
  app.event("reaction_added", async ({ event }) => {

    if (event.reaction !== POSITIVE_REACTION || event.item.type !== "message") {
      return;
    }

    const trackedMessage = stateStore.getLastHoMessage();

    if (!trackedMessage) {
      return;
    }

    if (event.item.channel !== trackedMessage.channelId || event.item.ts !== trackedMessage.messageTs) {
      return;
    }

    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after reaction_added", error);
    }
  });

  app.event("reaction_removed", async ({ event }) => {

    if (event.reaction !== POSITIVE_REACTION || event.item.type !== "message") {
      return;
    }

    const trackedMessage = stateStore.getLastHoMessage();

    if (!trackedMessage) {
      return;
    }

    if (event.item.channel !== trackedMessage.channelId || event.item.ts !== trackedMessage.messageTs) {
      return;
    }

    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after reaction_removed", error);
    }
  });
}

export function registerGlobalErrorHandler(app: App): void {
  app.error(async (error) => {
    logger.error("Unhandled Slack Bolt error", error);
  });
}