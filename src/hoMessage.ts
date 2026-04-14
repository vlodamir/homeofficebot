export function buildHoMessageText(dayName: string, approvedNames: string[], highlightedNames: string[] = []): string {
  const header = `🏠 *HO ${dayName}*`;
  const separator = "─────────────────";
  const names = approvedNames.map((name) => {
    const isHighlighted = highlightedNames.includes(name);
    return isHighlighted ? `👤 *${name}* 🔥` : `👤 ${name}`;
  });
  return [header, separator, ...names].join("\n");
}

export function buildWeeklyStatsMessage(weekStart: string, userHoCounts: Record<string, number>): string {
  const header = `📊 *Weekly HO Stats* (${weekStart})`;
  const separator = "─────────────────";
  
  // Sort by count descending, then by name
  const sortedUsers = Object.entries(userHoCounts)
    .sort(([nameA, countA], [nameB, countB]) => {
      if (countB !== countA) return countB - countA;
      return nameA.localeCompare(nameB, "cs");
    });
  
  // Highlight users with more than 2 HOs
  const lines = sortedUsers.map(([name, count]) => {
    const fire = count > 2 ? " 🔥" : "";
    return `${name}: ${count} day${count !== 1 ? "s" : ""}${fire}`;
  });
  
  return [header, separator, ...lines].join("\n");
}