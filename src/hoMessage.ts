export function buildHoMessageBlocks(
  dayName: string,
  homeOfficeNames: string[] = [],
  vacationNames: string[] = [],
  inOfficeNames: string[] = [],
  plannedHoNames: string[] = [],
  plannedVacationNames: string[] = []
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
    let messageText = `🏠 *Home Office (${homeOfficeNames.length + plannedHoNames.length}):*\n`;
    if (homeOfficeNames.length > 0 || plannedHoNames.length > 0) {
      messageText += "```\n";

      homeOfficeNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });
      plannedHoNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });

      messageText += "```";
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
    let messageText = `🏝️ *Vacation (${vacationNames.length + plannedVacationNames.length}):*\n`;
    if (vacationNames.length > 0 || plannedVacationNames.length > 0) {
      messageText += "```\n";

      vacationNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });
      plannedVacationNames.forEach((name) => {
        messageText += `• ${name}\n`;
      });

      messageText += "```";
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
        text: `*Onsite (${inOfficeNames.length})*`,
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
          text: "🏠 Home Office",
        },
        value: "ho",
        action_id: "ho_button",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "🏝️ Vacation",
        },
        value: "vacation",
        action_id: "vacation_button",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "📅 Planned Out of Office",
        },
        value: "planned",
        action_id: "planned_ooo_button",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: ":office: Show all Onsite",
        },
        value: JSON.stringify(inOfficeNames),
        action_id: "show_all_in_office",
      },
    ],
  });

  return blocks;
}