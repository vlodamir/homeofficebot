import { createHash } from "node:crypto";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import rendererWasm from "@resvg/resvg-wasm/index_bg.wasm";
import regularFont from "../assets/fonts/DejaVuSans.ttf";
import boldFont from "../assets/fonts/DejaVuSans-Bold.ttf";
import { VacationAvatarCache } from "./vacationAvatars";
import { VacationMonth } from "./vacationMonth";

export const VACATION_TIMELINE_VERSION = 3;

export interface VacationProfile {
  name: string;
  avatarUrl?: string;
}

const style = {
  padding: 20,
  nameWidth: 160,
  dayWidth: 22,
  rowHeight: 37,
  headerHeight: 46,
  histogramHeight: 42,
  panelGap: 14,
  barRadius: 7,
  scale: 3,
  font: "DejaVu Sans, sans-serif",
  fonts: { title: 25, label: 15, name: 14, day: 14, small: 11 },
  background: "#f5f7fb",
  panel: "#ffffff",
  ink: "#1e2940",
  secondary: "#52617a",
  grid: "#e7ebf2",
  weekend: "#f0f2f6",
  holiday: "#fbe5ed",
  overlap: "#fff1da",
  today: "#405dd8",
  histogram: "#a2afca",
  histogramOverlap: "#c7862d",
  employees: [
    ["#c9d5ff", "#2d4085"], ["#bfe6df", "#235b52"], ["#ead5f7", "#643c7c"],
    ["#ffdbc8", "#813e29"], ["#c8e1f6", "#26547a"], ["#dce9be", "#425d23"],
    ["#f5cfe0", "#803350"], ["#d7d5ef", "#4d487f"],
    ["#f2dfb7", "#745322"], ["#cbdcfa", "#315484"],
    ["#f4d8d8", "#794650"], ["#cce6ca", "#365f38"],
  ],
};

const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const panelDays = 16;
let rendererReady: Promise<void> | undefined;

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function rect(x: number, y: number, width: number, height: number, fill: string, radius = 0): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`;
}

function text(x: number, y: number, value: string, size: number, fill = style.ink, weight = 400, center = false): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}"${center ? ' text-anchor="middle"' : ""}>${escapeXml(value)}</text>`;
}

function employeeNameLines(name: string): string[] {
  const limit = 14;
  const characters = [...name];
  if (characters.length <= limit) return [name];
  const firstLine = characters.slice(0, limit + 1).join("");
  const breakAt = firstLine.lastIndexOf(" ");
  if (breakAt < 1) return [`${characters.slice(0, limit - 1).join("")}…`];
  const remaining = [...name.slice(breakAt + 1)];
  return [name.slice(0, breakAt), remaining.length <= limit
    ? remaining.join("")
    : `${remaining.slice(0, limit - 1).join("")}…`];
}

export async function renderVacationTimeline(
  month: VacationMonth,
  profiles: ReadonlyMap<string, VacationProfile>,
  avatars = new VacationAvatarCache(),
): Promise<Buffer> {
  const { padding, nameWidth, dayWidth, rowHeight, headerHeight, histogramHeight, panelGap, fonts } = style;
  const employees = await Promise.all(month.employees.map(async (employee) => {
    const profile = profiles.get(employee.userId);
    const name = (profile?.name || employee.userId).replace(/\s+/g, " ").trim();
    const colorIndex = createHash("sha256").update(employee.userId).digest().readUInt32BE() % style.employees.length;
    return { ...employee, name, color: style.employees[colorIndex], avatar: await avatars.get(profile?.avatarUrl) };
  }));
  employees.sort((left, right) => left.name.localeCompare(right.name, "cs") || left.userId.localeCompare(right.userId));

  const panelWidth = nameWidth + panelDays * dayWidth;
  const width = padding * 2 + panelWidth;
  const gridX = padding + nameWidth;
  const peak = Math.max(1, ...month.days.map((day) => day.away));
  const elements = [text(padding, 39, month.label, fonts.title, style.ink, 650)];
  let y = 55;

  for (let offset = 0; offset < month.days.length; offset += panelDays) {
    const days = month.days.slice(offset, offset + panelDays);
    const firstDay = days[0].day;
    const lastDay = days[days.length - 1].day;
    const rows = employees.filter(({ spans }) => spans.some((span) => span.firstDay <= lastDay && span.lastDay >= firstDay));
    const bodyTop = y + headerHeight;
    const histogramTop = bodyTop + Math.max(rows.length, 1) * rowHeight;
    const baseline = histogramTop + histogramHeight - 7;
    const panelHeight = baseline + 7 - y;

    elements.push(rect(padding, y, panelWidth, panelHeight, style.panel, 14));
    elements.push(text(padding + 12, y + 28, "Teammate", fonts.label, style.secondary, 600));

    for (const { day, weekday, holiday, away } of days) {
      const x = gridX + (day - firstDay) * dayWidth;
      const middle = x + dayWidth / 2;
      const weekend = weekday === 0 || weekday === 6;
      if (holiday || weekend) {
        elements.push(rect(x, y + 6, dayWidth, panelHeight - 12, holiday ? style.holiday : style.weekend));
      }
      if (away > 1) elements.push(rect(x, bodyTop, dayWidth, baseline - bodyTop + 2, style.overlap));
      elements.push(rect(x, bodyTop, 1, baseline - bodyTop + 2, style.grid));
      if (day === month.today) {
        elements.push(rect(middle - 8.5, y + 16, 17, 19, style.today, 5));
        elements.push(rect(middle - 0.75, bodyTop, 1.5, baseline - bodyTop + 2, style.today));
      }
      elements.push(text(middle, y + 13, weekdays[weekday], fonts.small, style.secondary, 400, true));
      elements.push(text(middle, y + 30, String(day), fonts.day, day === month.today ? style.panel : style.ink, 600, true));

      if (away > 0) {
        const barHeight = Math.round((away / peak) * 19) + 2;
        const color = away > 1 ? style.histogramOverlap : style.histogram;
        elements.push(rect(middle - 5, baseline - barHeight, 10, barHeight, color, 2));
        elements.push(text(middle, baseline - barHeight - 3, String(away), fonts.small, style.ink, 600, true));
      }
    }

    elements.push(rect(padding + 12, histogramTop, panelWidth - 24, 1, style.grid));
    elements.push(text(padding + 12, histogramTop + 26, "People away", fonts.label, style.secondary, 550));
    if (rows.length === 0) elements.push(text(gridX + 8, bodyTop + 24, "No vacations", fonts.label, style.secondary));

    rows.forEach(({ name, avatar, color, spans }, index) => {
      const top = bodyTop + index * rowHeight;
      const [fill, ink] = color;
      const nameX = padding + 43;
      const avatarX = padding + 12;
      const clipId = `employee-${offset}-${index}`;
      const initials = name.split(" ").slice(0, 2).map((word) => [...word][0]).join("").toLocaleUpperCase();
      elements.push(rect(avatarX, top + 7, 22, 22, fill, 11));
      elements.push(text(avatarX + 11, top + 22, initials, fonts.small, ink, 650, true));
      if (avatar) {
        elements.push(`<clipPath id="${clipId}-avatar"><circle cx="${avatarX + 11}" cy="${top + 18}" r="11"/></clipPath>`);
        elements.push(`<image x="${avatarX}" y="${top + 7}" width="22" height="22" xlink:href="${avatar}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId}-avatar)"/>`);
      }
      elements.push(`<clipPath id="${clipId}">${rect(nameX, top, nameWidth - 47, rowHeight, style.panel)}</clipPath>`);
      const lines = employeeNameLines(name);
      const firstBaseline = top + (lines.length === 1 ? 23 : 15);
      const nameText = lines.map((line, lineIndex) => text(nameX, firstBaseline + lineIndex * 15, line, fonts.name, style.ink, 500));
      elements.push(`<g clip-path="url(#${clipId})">${nameText.join("")}</g>`);

      for (const span of spans) {
        const from = Math.max(span.firstDay, firstDay);
        const to = Math.min(span.lastDay, lastDay);
        if (from > to) continue;
        const left = gridX + (from - firstDay) * dayWidth + 2;
        const barWidth = (to - from + 1) * dayWidth - 4;
        elements.push(rect(left, top + 8, barWidth, 21, fill, style.barRadius));
        if (span.duration && barWidth >= 40) {
          elements.push(text(left + barWidth / 2, top + 23, `${span.duration}d`, fonts.small + 1, ink, 650, true));
        }
      }
    });

    y += panelHeight + panelGap;
  }

  const legendItems = [
    { x: 0, color: style.employees[0][0], label: "Vacation" },
    { x: 100, color: style.weekend, label: "Weekend" },
    { x: 202, color: style.holiday, label: "Holiday" },
    { x: 298, color: style.overlap, label: "2+ away" },
    { x: 391, color: style.today, label: "Today" },
  ];
  for (const item of legendItems) {
    elements.push(rect(padding + item.x, y + 2, item.label === "Today" ? 2 : 14, 13, item.color, 2));
    elements.push(text(padding + item.x + (item.label === "Today" ? 8 : 20), y + 14, item.label, fonts.label, style.secondary));
  }

  const height = y + 29;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * style.scale}" height="${height * style.scale}" viewBox="0 0 ${width} ${height}" font-family="${style.font}">${rect(0, 0, width, height, style.background, 18)}${elements.join("")}</svg>`;
  await (rendererReady ??= initWasm(rendererWasm));
  const renderer = new Resvg(svg, {
    font: { fontBuffers: [regularFont, boldFont], defaultFontFamily: "DejaVu Sans" },
  });
  try {
    const image = renderer.render();
    try {
      return Buffer.from(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
