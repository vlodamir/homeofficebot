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