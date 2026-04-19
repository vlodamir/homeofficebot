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
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🏠 *Office ${dayName}*`,
      },
    },
  ];

  if (inOfficeNames.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Onsite (${inOfficeNames.length}):*\n${inOfficeNames.map((name) => `• ${name}`).join("\n")}`,
      },
    });
  }

  if (homeOfficeNames.length > 0 || plannedHoNames.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Home Office (${homeOfficeNames.length + plannedHoNames.length}):*\n${homeOfficeNames.map((name) => `• ${name}`).join("\n")}\n${plannedHoNames.map((name) => `• ${name}`).join("\n")}`,
      },
    });
  }

  if (vacationNames.length > 0 || plannedVacationNames.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Vacation (${vacationNames.length + plannedVacationNames.length}):*\n${vacationNames.map((name) => `• ${name}`).join("\n")}\n${plannedVacationNames.map((name) => `• ${name}`).join("\n")}`,
      },
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
    ],
  });

  return blocks;
}