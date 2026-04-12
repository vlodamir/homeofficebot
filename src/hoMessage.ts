export function buildHoMessageText(dayName: string, approvedNames: string[]): string {
  const header = `🏠 *HO ${dayName}*`;
  const separator = "─────────────────";
  const names = approvedNames.map((name) => `👤 ${name}`);
  return [header, separator, ...names].join("\n");
}