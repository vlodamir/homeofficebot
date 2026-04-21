import { randomUUID } from "node:crypto";
import { App } from "@slack/bolt";
import { buildHoMessageBlocks } from "./hoMessage";
import { logger } from "./logger";
import { StateStore } from "./state";
import { AppConfig, HOMessageState, RuntimeContext, PlannedOutOfOffice } from "./types";
import { getCzechWeekdayNameFromIso } from "./date";

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

export async function postHoMessage(app: App, channelId: string, targetDate: string, teamMemberIds: string[] = [], stateStore?: StateStore): Promise<HOMessageState> {
  const dayName = getCzechWeekdayNameFromIso(targetDate);
  
  // Resolve names for team members and create proper ID-to-name mapping
  const names = await Promise.all(teamMemberIds.map((userId) => resolveUserDisplayName(app, userId)));
  const userIdToName = new Map<string, string>();
  for (let i = 0; i < teamMemberIds.length; i++) {
    userIdToName.set(teamMemberIds[i], names[i]);
  }
  
  // Create pairs of userId and name, sort by name
  const userNamePairs = Array.from(userIdToName.entries()).sort((a, b) => a[1].localeCompare(b[1], "cs"));
  const teamMemberNames = userNamePairs.map(([, name]) => name);
  
  let plannedHoNames: string[] = [];
  let plannedVacationNames: string[] = [];
  let inOfficeNames = teamMemberNames;
  
  // Filter out planned out of office entries if stateStore is provided
  if (stateStore) {
    const plannedEntries = stateStore.getPlannedOutOfOffice();
    const plannedHoEntries = plannedEntries.filter(
      (entry) => entry.type === "ho" && isDateInRange(targetDate, entry.startDate, entry.endDate)
    );
    const plannedVacationEntries = plannedEntries.filter(
      (entry) => entry.type === "vacation" && isDateInRange(targetDate, entry.startDate, entry.endDate)
    );
    
    // Get names for planned users with date ranges
    for (const entry of plannedHoEntries) {
      const name = await resolveUserDisplayName(app, entry.userId);
      const dateRange = formatDateRange(entry.startDate, entry.endDate);
      plannedHoNames.push(`${name} (${dateRange})`);
    }
    plannedHoNames.sort();
    
    for (const entry of plannedVacationEntries) {
      const name = await resolveUserDisplayName(app, entry.userId);
      const dateRange = formatDateRange(entry.startDate, entry.endDate);
      plannedVacationNames.push(`${name} (${dateRange})`);
    }
    plannedVacationNames.sort();
    
    // Build a set of users with planned OOO
    const plannedHoUserIds = new Set(plannedHoEntries.map(e => e.userId));
    const plannedVacationUserIds = new Set(plannedVacationEntries.map(e => e.userId));
    
    // Filter in-office names to exclude planned OOO users
    inOfficeNames = teamMemberNames.filter((name) => {
      const userId = userNamePairs.find(([, n]) => n === name)?.[0];
      return userId && !plannedHoUserIds.has(userId) && !plannedVacationUserIds.has(userId);
    });
  }
  
  const blocks = buildHoMessageBlocks(dayName, [], [], inOfficeNames, plannedHoNames, plannedVacationNames);

  const response = await app.client.chat.postMessage({
    channel: channelId,
    text: `HO ${dayName}`,
    blocks,
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

async function resolveTeamMemberNames(app: App, teamMemberIds: string[]): Promise<string[]> {
  const names = await Promise.all(teamMemberIds.map((userId) => resolveUserDisplayName(app, userId)));
  return names.sort((left, right) => left.localeCompare(right, "cs"));
}

function isDateInRange(targetDate: string, startDate: string, endDate?: string): boolean {
  if (targetDate < startDate) {
    return false;
  }
  if (endDate && targetDate > endDate) {
    return false;
  }
  return true;
}

function formatDateRange(startDate: string, endDate?: string): string {
  const start = new Date(startDate + "T00:00:00");
  const end = endDate ? new Date(endDate + "T00:00:00") : start;

  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
  const dayFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric" });

  const startMonth = monthFormatter.format(start);
  const startDay = dayFormatter.format(start);
  const endMonth = monthFormatter.format(end);
  const endDay = dayFormatter.format(end);

  // No end date - show "since [date]" to indicate it's ongoing
  if (!endDate) {
    return `since ${startMonth} ${startDay}`;
  }

  if (startDate === endDate) {
    return `${startMonth} ${startDay}`;
  }

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }

  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

function doDateRangesOverlap(
  start1: string,
  end1: string | undefined,
  start2: string,
  end2: string | undefined
): boolean {
  // If either range has no end date, we consider it as extending to a far future date
  const effectiveEnd1 = end1 || "2099-12-31";
  const effectiveEnd2 = end2 || "2099-12-31";

  // Two ranges overlap if: start1 <= end2 AND start2 <= end1
  return start1 <= effectiveEnd2 && start2 <= effectiveEnd1;
}

function findOverlappingPlannedOOO(
  userId: string,
  startDate: string,
  endDate: string | undefined,
  plannedEntries: PlannedOutOfOffice[]
): PlannedOutOfOffice | undefined {
  return plannedEntries.find(
    (entry) =>
      entry.userId === userId &&
      doDateRangesOverlap(startDate, endDate, entry.startDate, entry.endDate)
  );
}

function buildPlannedOOOModal(userId: string, plannedEntries: PlannedOutOfOffice[]): any[] {
  const blocks: any[] = [];

  if (plannedEntries.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No planned out of office entries.",
      },
    });
  } else {
    plannedEntries.forEach((entry) => {
      if (entry.userId !== userId) {
        return; // Only show entries for the current user
      }

      const typeLabel = entry.type === "ho" ? "🏠 Home Office" : "🏝️ Vacation";
      const endDateText = entry.endDate ? ` → ${entry.endDate}` : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${typeLabel}\n_${entry.startDate}${endDateText}_`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Remove",
          },
          value: entry.id,
          action_id: `remove_planned_${entry.id}`,
          style: "danger",
        },
      });
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "+ Add Entry",
        },
        action_id: "add_planned_entry",
        value: "add_entry",
      },
    ],
  });

  return blocks;
}

export async function getHomeOfficeUsers(app: App, hoUsers: string[], botUserId: string): Promise<string[]> {
  const uniqueUsers = Array.from(new Set(hoUsers.filter((userId) => userId !== botUserId)));
  const names = await Promise.all(uniqueUsers.map((userId) => resolveUserDisplayName(app, userId)));

  return names.sort((left, right) => left.localeCompare(right, "cs"));
}

export async function getVacationUsers(app: App, vacationUsers: string[], botUserId: string): Promise<string[]> {
  const uniqueUsers = Array.from(new Set(vacationUsers.filter((userId) => userId !== botUserId)));
  const names = await Promise.all(uniqueUsers.map((userId) => resolveUserDisplayName(app, userId)));

  return names.sort((left, right) => left.localeCompare(right, "cs"));
}

export async function syncTrackedHoMessage(app: App, stateStore: StateStore, runtime: RuntimeContext, teamMemberIds: string[] = []): Promise<void> {
  const trackedMessage = stateStore.getLastHoMessage();

  if (!trackedMessage) {
    logger.info("No tracked HO message in state, skipping sync");
    return;
  }

  // Clean up expired planned out of office entries
  const hasExpired = stateStore.cleanupExpiredPlannedOutOfOffice(trackedMessage.targetDate);
  if (hasExpired) {
    await stateStore.saveState();
  }

  const hoUsers = trackedMessage.hoUsers ?? [];
  const vacationUsers = trackedMessage.vacationUsers ?? [];
  const plannedEntries = stateStore.getPlannedOutOfOffice();

  // Get users from planned entries for today
  const plannedHoEntries = plannedEntries.filter(
    (entry) => entry.type === "ho" && isDateInRange(trackedMessage.targetDate, entry.startDate, entry.endDate)
  );
  const plannedVacationEntries = plannedEntries.filter(
    (entry) => entry.type === "vacation" && isDateInRange(trackedMessage.targetDate, entry.startDate, entry.endDate)
  );

  // Get names for voted users (only those who voted today, not planned)
  const homeOfficeUsers = await getHomeOfficeUsers(app, hoUsers, runtime.botUserId);
  const vacationUserNames = await getVacationUsers(app, vacationUsers, runtime.botUserId);
  
  // Get names for planned users with date ranges
  const plannedHoNames: string[] = [];
  for (const entry of plannedHoEntries) {
    const name = await resolveUserDisplayName(app, entry.userId);
    const dateRange = formatDateRange(entry.startDate, entry.endDate);
    plannedHoNames.push(`${name} (${dateRange})`);
  }
  plannedHoNames.sort();

  const plannedVacationNames: string[] = [];
  for (const entry of plannedVacationEntries) {
    const name = await resolveUserDisplayName(app, entry.userId);
    const dateRange = formatDateRange(entry.startDate, entry.endDate);
    plannedVacationNames.push(`${name} (${dateRange})`);
  }
  plannedVacationNames.sort();
  
  // Resolve names for team members and create proper ID-to-name mapping
  const names = await Promise.all(teamMemberIds.map((userId) => resolveUserDisplayName(app, userId)));
  const userIdToName = new Map<string, string>();
  for (let i = 0; i < teamMemberIds.length; i++) {
    userIdToName.set(teamMemberIds[i], names[i]);
  }
  
  // Create pairs of userId and name, sort by name
  const userNamePairs = Array.from(userIdToName.entries()).sort((a, b) => a[1].localeCompare(b[1], "cs"));
  const teamMemberNames = userNamePairs.map(([, name]) => name);
  
  // Calculate in-office members (all team members minus HO, vacation, planned HO, and planned vacation)
  const plannedHoUserIds = new Set(plannedHoEntries.map(e => e.userId));
  const plannedVacationUserIds = new Set(plannedVacationEntries.map(e => e.userId));
  const hoUserSet = new Set([...hoUsers, ...plannedHoUserIds]);
  const vacationUserSet = new Set([...vacationUsers, ...plannedVacationUserIds]);
  
  const inOfficeNames = teamMemberNames.filter((name) => {
    // Find the user ID for this team member name
    const userId = userNamePairs.find(([, n]) => n === name)?.[0];
    return userId && !hoUserSet.has(userId) && !vacationUserSet.has(userId);
  });
  
  const blocks = buildHoMessageBlocks(
    getCzechWeekdayNameFromIso(trackedMessage.targetDate),
    homeOfficeUsers,
    vacationUserNames,
    inOfficeNames,
    plannedHoNames,
    plannedVacationNames
  );

  await app.client.chat.update({
    channel: trackedMessage.channelId,
    ts: trackedMessage.messageTs,
    text: `HO ${getCzechWeekdayNameFromIso(trackedMessage.targetDate)}`,
    blocks,
  });

  logger.info("Tracked HO message synchronized", {
    channelId: trackedMessage.channelId,
    messageTs: trackedMessage.messageTs,
    homeOfficeUsersCount: homeOfficeUsers.length,
    vacationUsersCount: vacationUserNames.length,
    plannedHoCount: plannedHoNames.length,
    plannedVacationCount: plannedVacationNames.length,
  });
}

export function registerButtonHandlers(app: App, stateStore: StateStore, runtime: RuntimeContext, teamMemberIds: string[] = []): void {
  app.action("ho_button", async ({ ack, body }) => {
    await ack();

    const trackedMessage = stateStore.getLastHoMessage();

    if (!trackedMessage || trackedMessage.messageTs !== (body as any).message.ts) {
      return;
    }

    const userId = body.user.id;

    // Check if user has a planned vacation or HO today
    const plannedEntries = stateStore.getPlannedOutOfOffice();
    const hasPlannedOOO = plannedEntries.some(
      (entry) => entry.userId === userId && isDateInRange(trackedMessage.targetDate, entry.startDate, entry.endDate)
    );

    if (hasPlannedOOO) {
      await app.client.chat.postEphemeral({
        channel: trackedMessage.channelId,
        user: userId,
        text: "You cannot change your status for today because you have a planned time off entry. Remove it from the Planned Out of Office list first.",
      });
      return;
    }

    // Toggle home office status
    const hoUsers = trackedMessage.hoUsers ?? [];
    if (hoUsers.includes(userId)) {
      stateStore.removeHoUser(userId);
    } else {
      stateStore.addHoUser(userId);
      // Remove from vacation if they were on vacation
      stateStore.removeVacationUser(userId);
    }

    await stateStore.saveState();

    try {
      await syncTrackedHoMessage(app, stateStore, runtime, teamMemberIds);
    } catch (error) {
      logger.error("Failed to sync HO message after button click", error);
    }
  });

  app.action("vacation_button", async ({ ack, body }) => {
    await ack();

    const trackedMessage = stateStore.getLastHoMessage();

    if (!trackedMessage || trackedMessage.messageTs !== (body as any).message.ts) {
      return;
    }

    const userId = body.user.id;

    // Check if user has a planned vacation or HO today
    const plannedEntries = stateStore.getPlannedOutOfOffice();
    const hasPlannedOOO = plannedEntries.some(
      (entry) => entry.userId === userId && isDateInRange(trackedMessage.targetDate, entry.startDate, entry.endDate)
    );

    if (hasPlannedOOO) {
      await app.client.chat.postEphemeral({
        channel: trackedMessage.channelId,
        user: userId,
        text: "You cannot change your status for today because you have a planned time off entry. Remove it from the Planned Out of Office list first.",
      });
      return;
    }

    // Toggle vacation status
    const vacationUsers = trackedMessage.vacationUsers ?? [];
    if (vacationUsers.includes(userId)) {
      stateStore.removeVacationUser(userId);
    } else {
      stateStore.addVacationUser(userId);
      // Remove from home office if they were on HO
      stateStore.removeHoUser(userId);
    }

    await stateStore.saveState();

    try {
      await syncTrackedHoMessage(app, stateStore, runtime, teamMemberIds);
    } catch (error) {
      logger.error("Failed to sync HO message after button click", error);
    }
  });

  app.action("planned_ooo_button", async ({ ack, body }) => {
    await ack();

    const trackedMessage = stateStore.getLastHoMessage();
    const hasExpired = stateStore.cleanupExpiredPlannedOutOfOffice(trackedMessage!.targetDate);
    if (hasExpired) {
      await stateStore.saveState();
    }

    const plannedEntries = stateStore.getPlannedOutOfOffice();
    const blocks = buildPlannedOOOModal(body.user.id, plannedEntries);

    await app.client.views.open({
      trigger_id: (body as any).trigger_id,
      view: {
        type: "modal",
        callback_id: "planned_ooo_modal",
        title: {
          type: "plain_text",
          text: "Planned Out of Office",
        },
        blocks,
      },
    });
  });

  app.action("show_all_in_office", async ({ ack, body }) => {
    await ack();
    
    const inOfficeNames = JSON.parse((body as any).actions[0].value) as string[];
    await app.client.views.open({
      trigger_id: (body as any).trigger_id,
      view: {
        type: "modal",
        callback_id: "planned_ooo_modal",
        title: {
          type: "plain_text",
          text: "Onsite",
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${inOfficeNames.map((name) => `• ${name}`).join("\n")}`,
            }
          },
        ],
      },
    });
  });
}

export function registerPlannedOOOHandlers(app: App, stateStore: StateStore, runtime: RuntimeContext, teamMemberIds: string[] = []): void {
  logger.info("Registering planned OOO handlers");

  app.action(/^remove_planned_/, async ({ ack, body }) => {
    logger.info("Remove planned OOO button clicked", { action_id: (body as any).actions?.[0]?.action_id });
    await ack();

    const actionId = (body as any).actions[0].action_id;
    const id = actionId.replace(/^remove_planned_/, "");
    
    if (!id) {
      logger.warn("Could not extract ID from action_id", { actionId });
      return;
    }

    stateStore.removePlannedOutOfOffice(id);
    await stateStore.saveState();

    const trackedMessage = stateStore.getLastHoMessage();
    stateStore.cleanupExpiredPlannedOutOfOffice(trackedMessage!.targetDate);

    // Reopen the modal with updated list
    const plannedEntries = stateStore.getPlannedOutOfOffice();
    const blocks = buildPlannedOOOModal(body.user.id, plannedEntries);

    await app.client.views.update({
      view_id: (body as any).view.id,
      view: {
        type: "modal",
        callback_id: "planned_ooo_modal",
        title: {
          type: "plain_text",
          text: "Planned Out of Office",
        },
        blocks,
      },
    });

    // Sync the HO message to reflect changes
    try {
      await syncTrackedHoMessage(app, stateStore, runtime, teamMemberIds);
    } catch (error) {
      logger.error("Failed to sync HO message after removing planned OOO", error);
    }
  });

  app.action("add_planned_entry", async ({ ack, body }) => {
    logger.info("Add planned entry button clicked");
    await ack();

    try {
      logger.info("Opening add planned OOO modal");
      
      await app.client.views.push({
        trigger_id: (body as any).trigger_id,
        view: {
          type: "modal",
          callback_id: "add_planned_ooo_form",
          title: {
            type: "plain_text",
            text: "Schedule Time Off",
          },
          submit: {
            type: "plain_text",
            text: "Add",
          },
          blocks: [
            {
              type: "input",
              block_id: "planned_type",
              label: {
                type: "plain_text",
                text: "Type",
              },
              element: {
                type: "static_select",
                action_id: "type_select",
                options: [
                  {
                    text: {
                      type: "plain_text",
                      text: "🏠 Home Office",
                    },
                    value: "ho",
                  },
                  {
                    text: {
                      type: "plain_text",
                      text: "🏝️ Vacation",
                    },
                    value: "vacation",
                  },
                ],
              },
            },
            {
              type: "input",
              block_id: "planned_start_date",
              label: {
                type: "plain_text",
                text: "Start Date",
              },
              element: {
                type: "datepicker",
                action_id: "start_date_picker",
              },
            },
            {
              type: "input",
              block_id: "planned_end_date",
              label: {
                type: "plain_text",
                text: "End Date (optional)",
              },
              element: {
                type: "datepicker",
                action_id: "end_date_picker",
              },
              optional: true,
            },
          ],
        },
      });
      logger.info("Modal opened successfully");
    } catch (error) {
      logger.error("Failed to open add planned OOO modal", error);
    }
  });

  app.view("add_planned_ooo_form", async ({ ack, body, view }) => {
    const values = view.state.values;
    logger.info("Form submitted", { values });

    const userId = body.user.id;
    const type = values.planned_type.type_select.selected_option?.value as "ho" | "vacation";
    const startDate = values.planned_start_date.start_date_picker.selected_date;
    const endDate = values.planned_end_date?.end_date_picker?.selected_date;

    logger.info("Extracted values", { userId, type, startDate, endDate });

    if (!userId || !type || !startDate) {
      logger.warn("Form validation failed", { userId, type, startDate });
      await ack({
        response_action: "errors",
        errors: {
          planned_start_date: "Start date is required",
        },
      });
      return;
    }

    // Check for overlapping planned out of office entries
    const plannedEntries = stateStore.getPlannedOutOfOffice();
    const overlappingEntry = findOverlappingPlannedOOO(userId, startDate as string, endDate ?? undefined, plannedEntries);

    if (overlappingEntry) {
      const existingRange = formatDateRange(overlappingEntry.startDate, overlappingEntry.endDate);
      logger.info("Overlapping planned OOO found", { overlappingEntry, newRange: `${startDate} to ${endDate}` });
      
      await ack({
        response_action: "errors",
        errors: {
          planned_start_date: `You already have a planned time off from ${existingRange}. Remove or modify that entry first.`,
        },
      });
      return;
    }

    await ack();

    const entry: PlannedOutOfOffice = {
      id: randomUUID(),
      userId,
      type,
      startDate: startDate as string,
      endDate: endDate ?? undefined,
    };

    logger.info("Creating planned entry", { entry });
    stateStore.addPlannedOutOfOffice(entry);

    // If the planned entry starts today, remove the user from today's votes
    const trackedMessage = stateStore.getLastHoMessage();
    if (trackedMessage && isDateInRange(trackedMessage.targetDate, entry.startDate, entry.endDate)) {
      stateStore.removeHoUser(userId);
      stateStore.removeVacationUser(userId);
    }

    await stateStore.saveState();

    // Sync the HO message to reflect changes
    try {
      await syncTrackedHoMessage(app, stateStore, runtime, teamMemberIds);
    } catch (error) {
      logger.error("Failed to sync HO message after adding planned OOO", error);
    }

    // Update the parent modal with the new list
    const previousViewId = (body as any).view.previous_view_id;
    if (previousViewId) {
      try {
        const plannedEntries = stateStore.getPlannedOutOfOffice();
        const blocks = buildPlannedOOOModal(body.user.id, plannedEntries);

        await app.client.views.update({
          view_id: previousViewId,
          view: {
            type: "modal",
            callback_id: "planned_ooo_modal",
            title: {
              type: "plain_text",
              text: "Planned Out of Office",
            },
            blocks,
          },
        });
      } catch (error) {
        logger.error("Failed to update parent modal after adding planned OOO", error);
      }
    }
  });
}

export function registerGlobalErrorHandler(app: App): void {
  app.error(async (error) => {
    logger.error("Unhandled Slack Bolt error", error);
  });
}