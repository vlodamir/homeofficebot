import { PlannedOutOfOffice } from "./types";

export function isActiveOrUpcomingVacation(entry: PlannedOutOfOffice, today: string): boolean {
  return entry.type === "vacation" && (!entry.endDate || entry.endDate >= today);
}

export function buildShowAllBlocks(
  inOfficeNames: string[],
  plannedEntries: PlannedOutOfOffice[],
  today: string,
  userNames: ReadonlyMap<string, string> = new Map(),
): any[] {
  const entries = plannedEntries
    .filter((entry) => isActiveOrUpcomingVacation(entry, today))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));

  const vacationLines = entries.map((entry) => {
    // ISO dates parsed at UTC midnight give calendar days, unaffected by DST.
    const daysUntilStart = (Date.parse(entry.startDate) - Date.parse(today)) / 86_400_000;
    const timing = daysUntilStart < 0
      ? "Ongoing"
      : daysUntilStart === 0
        ? "Starts today"
        : `Starts in ${daysUntilStart} ${daysUntilStart === 1 ? "day" : "days"}`;
    const dateRange = `${entry.startDate} → ${entry.endDate || "No end date"}`;
    const name = (userNames.get(entry.userId) || entry.userId)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `• ${name}\n  ${dateRange} · ${timing}`;
  });

  // Split long lists into sections to stay within Slack's section text limit.
  const sections = (lines: string[], emptyText: string): any[] => {
    const chunks: string[] = [];
    for (const line of lines) {
      const last = chunks.length - 1;
      if (last >= 0 && chunks[last].length + line.length + 1 <= 3000) {
        chunks[last] += `\n${line}`;
      } else {
        chunks.push(line);
      }
    }
    return (chunks.length ? chunks : [emptyText]).map((text) => ({
      type: "section",
      text: { type: "mrkdwn", text },
    }));
  };

  return [
    { type: "header", text: { type: "plain_text", text: "Onsite" } },
    ...sections(inOfficeNames.map((name) => `• ${name}`), "No teammates onsite."),
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "📅 Team vacations" } },
    ...sections(vacationLines, "No current or upcoming team vacations."),
  ];
}

export function buildHoMessageBlocks(
  dayName: string,
  homeOfficeNames: string[] = [],
  vacationNames: string[] = [],
  inOfficeNames: string[] = [],
  plannedHoNames: string[] = [],
  plannedVacationNames: string[] = [],
  confirmedOnsiteUsers: string[] = [],
): any[] {
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📅 ${dayName}`,
        emoji: true,
      },
      level: 1,
    },
  ];

  if (homeOfficeNames.length > 0 || plannedHoNames.length > 0) {
    let messageText = `🏠 *Home Office:*\n`;
    if (homeOfficeNames.length > 0 || plannedHoNames.length > 0) {

      homeOfficeNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });
      plannedHoNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: messageText,
      },
    });
  }

  if (vacationNames.length > 0 || plannedVacationNames.length > 0) {
    let messageText = `🏝️ *Vacation:*\n`;
    if (vacationNames.length > 0 || plannedVacationNames.length > 0) {
      vacationNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });
      plannedVacationNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: messageText,
      },
    });
  }

  if (inOfficeNames.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Onsite ${inOfficeNames.length} (${confirmedOnsiteUsers.length} confirmed)*`,
      }
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: ":white_check_mark: Confirm Onsite",
        },
        value: "onsite",
        action_id: "user_state_button_onsite",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "🏠 HO",
        },
        value: "ho",
        action_id: "user_state_button_ho",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "🏝️ Vacation",
        },
        value: "vacation",
        action_id: "user_state_button_vacation",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "📅 Planned Absences",
        },
        value: "planned",
        action_id: "planned_ooo_button",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: ":office: Show all",
        },
        value: JSON.stringify(inOfficeNames),
        action_id: "show_all_in_office",
      },
    ],
  });

  return blocks;
}
