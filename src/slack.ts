import { randomUUID } from "node:crypto";
import { App, type BlockAction, type ButtonAction, type types } from "@slack/bolt";
import { buildHoMessageBlocks } from "./hoMessage";
import { logger } from "./logger";
import type { AttendanceVote, StateStore } from "./state";
import { AppConfig, HOMessageState, RuntimeContext, PlannedOutOfOffice } from "./types";
import { getCzechWeekdayNameFromIso, getLocalDateInTimeZone } from "./date";
import { registerVacationModal } from "./vacationModal";
import type { VacationProfile } from "./vacationTimeline";

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
    const plannedEntries = stateStore.getPlannedOutOfOfficeOn(targetDate);
    const plannedHoEntries = plannedEntries.filter((entry) => entry.type === "ho");
    const plannedVacationEntries = plannedEntries.filter((entry) => entry.type === "vacation");
    
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
  return (await resolveUserProfile(app, userId)).name;
}

async function resolveUserProfile(app: App, userId: string): Promise<VacationProfile> {
  try {
    const response = await app.client.users.info({ user: userId });
    const profile = response.user?.profile;
    const realName = profile?.real_name?.trim();
    const displayName = profile?.display_name?.trim();
    const username = response.user?.name?.trim();

    return { name: realName || displayName || username || userId, avatarUrl: profile?.image_48 };
  } catch (error) {
    logger.warn("Failed to resolve user info, falling back to user ID", { userId, error });
    return { name: userId };
  }
}

async function resolveTeamMemberNames(app: App, teamMemberIds: string[]): Promise<string[]> {
  const names = await Promise.all(teamMemberIds.map((userId) => resolveUserDisplayName(app, userId)));
  return names.sort((left, right) => left.localeCompare(right, "cs"));
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

function buildPlannedOOOBlocks(entries: PlannedOutOfOffice[], names?: string[]): types.ModalView["blocks"] {
  const prefix = names ? "admin_" : "";
  const blocks: types.ModalView["blocks"] = entries.map((entry, index) => {
    const name = names ? `*${names[index]}*\n` : "";
    const typeLabel = entry.type === "ho" ? "🏠 Home Office" : "🏝️ Vacation";
    const endDateText = entry.endDate ? ` → ${entry.endDate}` : "";
    return {
      type: "section",
      text: { type: "mrkdwn", text: `${name}${typeLabel}\n_${entry.startDate}${endDateText}_` },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Remove" },
        value: entry.id,
        action_id: `${prefix}remove_planned_${entry.id}`,
        style: "danger",
      },
    };
  });
  if (blocks.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "No planned out of office entries." } });
  }
  blocks.push({
    type: "actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "+ Add Entry" },
      action_id: `${prefix}add_planned_entry`,
      value: "add_entry",
    }],
  });
  return blocks;
}

async function buildAdminPlannedOOOView(app: App, entries: PlannedOutOfOffice[]): Promise<types.ModalView> {
  const names = await Promise.all(entries.map((entry) => resolveUserDisplayName(app, entry.userId)));
  return {
    type: "modal",
    callback_id: "admin_ooo_modal",
    title: { type: "plain_text", text: "Manage Time Off" },
    blocks: buildPlannedOOOBlocks(entries, names),
  };
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

export async function syncTrackedHoMessage(app: App, stateStore: StateStore, runtime: RuntimeContext): Promise<void> {
  const trackedMessage = stateStore.getLastHoMessage();

  if (!trackedMessage) {
    logger.info("No tracked HO message in state, skipping sync");
    return;
  }

  const confirmedOnsiteUsers = trackedMessage.confirmedOnsiteUsers ?? [];
  const hoUsers = trackedMessage.hoUsers ?? [];
  const vacationUsers = trackedMessage.vacationUsers ?? [];
  const plannedEntries = stateStore.getPlannedOutOfOfficeOn(trackedMessage.targetDate);
  const plannedHoEntries = plannedEntries.filter((entry) => entry.type === "ho");
  const plannedVacationEntries = plannedEntries.filter((entry) => entry.type === "vacation");

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
  const teamMemberIds = stateStore.getTeamMembers();
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
  }).map((name) => {
    // Add a checkmark for users who have confirmed onsite
    const userId = userNamePairs.find(([, n]) => n === name)?.[0];
    if (userId && confirmedOnsiteUsers.includes(userId)) {
      return `${name} :white_check_mark:`;
    }

    return name;
  });
  
  const blocks = buildHoMessageBlocks(
    getCzechWeekdayNameFromIso(trackedMessage.targetDate),
    homeOfficeUsers,
    vacationUserNames,
    inOfficeNames,
    plannedHoNames,
    plannedVacationNames,
    confirmedOnsiteUsers
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

export function registerButtonHandlers(app: App, stateStore: StateStore, runtime: RuntimeContext, timezone: string, vacationCachePrefix?: string): void {
  app.action<BlockAction<ButtonAction>>(/^user_state_button_(onsite|ho|vacation)$/, async ({ ack, action, body }) => {
    await ack();

    const channelId = body.channel?.id ?? body.container.channel_id;
    const messageTs = body.message?.ts ?? body.container.message_ts;
    const status = action.value;
    if (!channelId || !messageTs || (status !== "onsite" && status !== "ho" && status !== "vacation")) return;
    const userId = body.user.id;
    const result = stateStore.toggleAttendanceVote({ channelId, messageTs }, userId, status);
    if (result === "stale") return;
    if (result === "planned") {
      await app.client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "You cannot change your status for today because you have a planned time off entry. Remove it from the Planned Out of Office list first.",
      });
      return;
    }

    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after button click", error);
    }
  });

  app.action<BlockAction<ButtonAction>>("planned_ooo_button", async ({ ack, body }) => {
    await ack();

    const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
    const entries = stateStore.getUpcomingPlannedOutOfOffice(today, body.user.id);

    const view: types.ModalView = {
      type: "modal",
      callback_id: "planned_ooo_modal",
      title: {
        type: "plain_text",
        text: "Planned Out of Office",
      },
      blocks: buildPlannedOOOBlocks(entries),
    };
    if (body.view) {
      await app.client.views.push({ trigger_id: body.trigger_id, view });
    } else {
      await app.client.views.open({ trigger_id: body.trigger_id, view });
    }
  });

  registerVacationModal(app, stateStore, timezone, runtime.botUserId, (userId) => resolveUserProfile(app, userId), vacationCachePrefix);
}

export function registerPlannedOOOHandlers(app: App, stateStore: StateStore, runtime: RuntimeContext, timezone: string): void {
  logger.info("Registering planned OOO handlers");

  app.action<BlockAction<ButtonAction>>(/^remove_planned_/, async ({ ack, action, body }) => {
    await ack();

    const id = action.action_id.replace(/^remove_planned_/, "");
    if (!id || !body.view) return;

    const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
    const removed = stateStore.removePlannedOutOfOffice(id, today, body.user.id);
    const entries = stateStore.getUpcomingPlannedOutOfOffice(today, body.user.id);

    await app.client.views.update({
      view_id: body.view.id,
      view: {
        type: "modal",
        callback_id: "planned_ooo_modal",
        title: {
          type: "plain_text",
          text: "Planned Out of Office",
        },
        blocks: buildPlannedOOOBlocks(entries),
      },
    });

    if (!removed) return;
    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
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
                text: "End Date",
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
    const type = values.planned_type.type_select.selected_option?.value;
    const startDate = values.planned_start_date.start_date_picker.selected_date;
    const endDate = values.planned_end_date?.end_date_picker?.selected_date;

    logger.info("Extracted values", { userId, type, startDate, endDate });

    if (!userId || (type !== "ho" && type !== "vacation") || !startDate) {
      logger.warn("Form validation failed", { userId, type, startDate });
      await ack({
        response_action: "errors",
        errors: {
          planned_start_date: "Start date is required",
        },
      });
      return;
    }

    if (endDate && endDate < startDate) {
      await ack({ response_action: "errors", errors: { planned_end_date: "End date must be on or after the start date." } });
      return;
    }

    const entry: PlannedOutOfOffice = { id: randomUUID(), userId, type, startDate, endDate: endDate ?? undefined };
    let overlappingEntry: PlannedOutOfOffice | undefined;
    try {
      overlappingEntry = stateStore.tryAddPlannedOutOfOffice(entry);
    } catch (error) {
      logger.error("Failed to save planned OOO", error);
      await ack({ response_action: "errors", errors: { planned_start_date: "Could not save the entry. Please try again." } });
      return;
    }

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

    // Sync the HO message to reflect changes
    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after adding planned OOO", error);
    }

    // Update the parent modal with the new list
    const previousViewId = (body as any).view.previous_view_id;
    if (previousViewId) {
      try {
        const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
        const entries = stateStore.getUpcomingPlannedOutOfOffice(today, userId);

        await app.client.views.update({
          view_id: previousViewId,
          view: {
            type: "modal",
            callback_id: "planned_ooo_modal",
            title: {
              type: "plain_text",
              text: "Planned Out of Office",
            },
            blocks: buildPlannedOOOBlocks(entries),
          },
        });
      } catch (error) {
        logger.error("Failed to update parent modal after adding planned OOO", error);
      }
    }
  });
}

export function registerAdminHandlers(app: App, stateStore: StateStore, runtime: RuntimeContext, timezone: string, adminUserIds: string[] = []): void {
  logger.info("Registering admin handlers");

  // Command to manage user status
  app.command("/hovnobot-team-members", async ({ ack, body, respond }) => {
    await ack();

    const userId = body.user_id;
    if (!adminUserIds.includes(userId)) {
      await respond({
        text: "You do not have permission to use this command.",
        response_type: "ephemeral",
      });
      return;
    }

    const members = stateStore.getTeamMembers();
    const memberNames = await Promise.all(members.map((id) => resolveUserDisplayName(app, id)));
    const currentMembersText = members.length > 0
      ? members.map((id, index) => `• ${memberNames[index]}`).join("\n")
      : "No team members configured yet.";

    try {
      await app.client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: "modal",
          callback_id: "admin_team_members_modal",
          title: {
            type: "plain_text",
            text: "Team Members",
          },
          submit: {
            type: "plain_text",
            text: "Save",
          },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Current team members:*\n${currentMembersText}`,
              },
            },
            {
              type: "input",
              block_id: "team_members",
              label: {
                type: "plain_text",
                text: "Select team members",
              },
              element: {
                type: "multi_users_select",
                action_id: "selected_users",
                initial_users: members,
              },
            },
          ],
        },
      });
    } catch (error) {
      logger.error("Failed to open team members modal", error);
      await respond({
        text: "Failed to open the modal. Please try again.",
        response_type: "ephemeral",
      });
    }
  });

  app.view("admin_team_members_modal", async ({ ack, body, view }) => {
    const values = view.state.values;
    const selectedUsers = values.team_members.selected_users.selected_users || [];

    await ack();

    stateStore.setTeamMembers(selectedUsers, getLocalDateInTimeZone(new Date(), timezone).isoDate);

    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after team member update", error);
    }
  });

  app.command("/hovnobot-user-status", async ({ ack, body, respond }) => {
    await ack();

    const userId = body.user_id;
    if (!adminUserIds.includes(userId)) {
      await respond({
        text: "You do not have permission to use this command.",
        response_type: "ephemeral",
      });
      return;
    }

    const trackedMessage = stateStore.getLastHoMessage();
    if (!trackedMessage) {
      await respond({
        text: "No tracked HO message found. Please wait for the next scheduled message.",
        response_type: "ephemeral",
      });
      return;
    }

    // Resolve team member names
    const members = stateStore.getTeamMembers();
    const names = await Promise.all(members.map((id) => resolveUserDisplayName(app, id)));
    const userNamePairs = members.map((id, index) => ({ id, name: names[index] }));
    userNamePairs.sort((a, b) => a.name.localeCompare(b.name, "cs"));

    try {
      await app.client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: "modal",
          callback_id: "admin_user_status_modal",
          title: {
            type: "plain_text",
            text: "Manage User Status",
          },
          submit: {
            type: "plain_text",
            text: "Apply",
          },
          blocks: [
            {
              type: "input",
              block_id: "admin_user_select",
              label: {
                type: "plain_text",
                text: "Select User",
              },
              element: {
                type: "static_select",
                action_id: "user_select",
                options: userNamePairs.map((pair) => ({
                  text: {
                    type: "plain_text",
                    text: pair.name,
                  },
                  value: pair.id,
                })),
              },
            },
            {
              type: "input",
              block_id: "admin_action_select",
              label: {
                type: "plain_text",
                text: "Action",
              },
              element: {
                type: "static_select",
                action_id: "action_select",
                options: [
                  {
                    text: {
                      type: "plain_text",
                      text: "Set Onsite",
                    },
                    value: "set_onsite",
                  },
                  {
                    text: {
                      type: "plain_text",
                      text: "Set Home Office",
                    },
                    value: "set_ho",
                  },
                  {
                    text: {
                      type: "plain_text",
                      text: "Set Vacation",
                    },
                    value: "set_vacation",
                  },
                  {
                    text: {
                      type: "plain_text",
                      text: "Clear Status",
                    },
                    value: "clear_status",
                  },
                ],
              },
            },
          ],
        },
      });
    } catch (error) {
      logger.error("Failed to open admin user status modal", error);
      await respond({
        text: "Failed to open the modal. Please try again.",
        response_type: "ephemeral",
      });
    }
  });

  app.view("admin_user_status_modal", async ({ ack, body, view }) => {
    const values = view.state.values;
    const targetUserId = values.admin_user_select.user_select.selected_option?.value;
    const action = values.admin_action_select.action_select.selected_option?.value;

    if (!targetUserId || !action) {
      await ack({
        response_action: "errors",
        errors: {
          admin_user_select: "Please select a user",
        },
      });
      return;
    }

    await ack();

    let status: AttendanceVote | null;
    switch (action) {
      case "set_onsite": status = "onsite"; break;
      case "set_ho": status = "ho"; break;
      case "set_vacation": status = "vacation"; break;
      case "clear_status": status = null; break;
      default: return;
    }
    if (!stateStore.setAttendanceVote(targetUserId, status)) {
      logger.warn("No tracked message when applying admin action");
      return;
    }

    // Sync the HO message
    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after admin action", error);
    }
  });

  // Command to manage planned out of office
  app.command("/hovnobot-ooo", async ({ ack, body, respond }) => {
    await ack();

    const userId = body.user_id;
    if (!adminUserIds.includes(userId)) {
      await respond({
        text: "You do not have permission to use this command.",
        response_type: "ephemeral",
      });
      return;
    }

    try {
      const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
      const entries = stateStore.getUpcomingPlannedOutOfOffice(today);
      await app.client.views.open({
        trigger_id: body.trigger_id,
        view: await buildAdminPlannedOOOView(app, entries),
      });
    } catch (error) {
      logger.error("Failed to open admin OOO modal", error);
      await respond({
        text: "Failed to open the modal. Please try again.",
        response_type: "ephemeral",
      });
    }
  });

  app.action<BlockAction<ButtonAction>>(/^admin_remove_planned_/, async ({ ack, action, body }) => {
    await ack();

    const userId = body.user.id;
    if (!adminUserIds.includes(userId)) {
      return;
    }

    const id = action.action_id.replace(/^admin_remove_planned_/, "");
    if (!id || !body.view) return;

    const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
    const removed = stateStore.removePlannedOutOfOffice(id, today);
    const entries = stateStore.getUpcomingPlannedOutOfOffice(today);
    await app.client.views.update({
      view_id: body.view.id,
      view: await buildAdminPlannedOOOView(app, entries),
    });

    if (!removed) return;
    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after admin removing planned OOO", error);
    }
  });

  app.action("admin_add_planned_entry", async ({ ack, body }) => {
    logger.info("Admin add planned entry button clicked");
    await ack();

    const userId = body.user.id;
    if (!adminUserIds.includes(userId)) {
      return;
    }

    // Resolve team member names for user selection
    const members = stateStore.getTeamMembers();
    const names = await Promise.all(members.map((id) => resolveUserDisplayName(app, id)));
    const userNamePairs = members.map((id, index) => ({ id, name: names[index] }));
    userNamePairs.sort((a, b) => a.name.localeCompare(b.name, "cs"));

    try {
      logger.info("Opening admin add planned OOO modal");

      await app.client.views.push({
        trigger_id: (body as any).trigger_id,
        view: {
          type: "modal",
          callback_id: "admin_add_planned_ooo_form",
          title: {
            type: "plain_text",
            text: "Add Time Off Entry",
          },
          submit: {
            type: "plain_text",
            text: "Add",
          },
          blocks: [
            {
              type: "input",
              block_id: "admin_ooo_user",
              label: {
                type: "plain_text",
                text: "User",
              },
              element: {
                type: "static_select",
                action_id: "user_select",
                options: userNamePairs.map((pair) => ({
                  text: {
                    type: "plain_text",
                    text: pair.name,
                  },
                  value: pair.id,
                })),
              },
            },
            {
              type: "input",
              block_id: "admin_ooo_type",
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
              block_id: "admin_ooo_start_date",
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
              block_id: "admin_ooo_end_date",
              label: {
                type: "plain_text",
                text: "End Date",
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
      logger.info("Admin modal opened successfully");
    } catch (error) {
      logger.error("Failed to open admin add planned OOO modal", error);
    }
  });

  app.view("admin_add_planned_ooo_form", async ({ ack, body, view }) => {
    const userId = body.user.id;
    if (!adminUserIds.includes(userId)) {
      await ack();
      return;
    }

    const values = view.state.values;
    logger.info("Admin add planned form submitted", { values });

    const targetUserId = values.admin_ooo_user.user_select.selected_option?.value;
    const type = values.admin_ooo_type.type_select.selected_option?.value;
    const startDate = values.admin_ooo_start_date.start_date_picker.selected_date;
    const endDate = values.admin_ooo_end_date?.end_date_picker?.selected_date;

    if (!targetUserId || (type !== "ho" && type !== "vacation") || !startDate) {
      await ack({
        response_action: "errors",
        errors: {
          admin_ooo_start_date: "Start date is required",
        },
      });
      return;
    }

    if (endDate && endDate < startDate) {
      await ack({ response_action: "errors", errors: { admin_ooo_end_date: "End date must be on or after the start date." } });
      return;
    }

    const entry: PlannedOutOfOffice = { id: randomUUID(), userId: targetUserId, type, startDate, endDate: endDate ?? undefined };
    let overlappingEntry: PlannedOutOfOffice | undefined;
    try {
      overlappingEntry = stateStore.tryAddPlannedOutOfOffice(entry);
    } catch (error) {
      logger.error("Failed to save admin planned OOO", error);
      await ack({ response_action: "errors", errors: { admin_ooo_start_date: "Could not save the entry. Please try again." } });
      return;
    }

    if (overlappingEntry) {
      const existingRange = formatDateRange(overlappingEntry.startDate, overlappingEntry.endDate);

      await ack({
        response_action: "errors",
        errors: {
          admin_ooo_start_date: `User already has a planned time off from ${existingRange}. Remove or modify that entry first.`,
        },
      });
      return;
    }

    await ack();

    // Sync the HO message
    try {
      await syncTrackedHoMessage(app, stateStore, runtime);
    } catch (error) {
      logger.error("Failed to sync HO message after admin adding planned OOO", error);
    }

    // Update parent modal
    const previousViewId = (body as any).view.previous_view_id;
    if (previousViewId) {
      try {
        const today = getLocalDateInTimeZone(new Date(), timezone).isoDate;
        const entries = stateStore.getUpcomingPlannedOutOfOffice(today);
        await app.client.views.update({
          view_id: previousViewId,
          view: await buildAdminPlannedOOOView(app, entries),
        });
      } catch (error) {
        logger.error("Failed to update parent modal after admin adding planned OOO", error);
      }
    }
  });
}

export function registerGlobalErrorHandler(app: App): void {
  app.error(async (error) => {
    logger.error("Unhandled Slack Bolt error", error);
  });
}
