import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import rendererWasm from "@resvg/resvg-wasm/index_bg.wasm";
import regularFont from "../assets/fonts/DejaVuSans.ttf";
import boldFont from "../assets/fonts/DejaVuSans-Bold.ttf";
import { logger } from "./logger";
import { VacationAvatarCache } from "./vacationAvatars";
import { VacationMonth } from "./vacationMonth";
import { encodeVacationPng } from "./vacationPng";

export const VACATION_TIMELINE_VERSION = 7;

export interface VacationProfile {
  name: string;
  avatarUrl?: string;
}

const style = {
  width: 1104,
  padding: 20,
  nameWidth: 160,
  rowHeight: 37,
  headerHeight: 46,
  histogramHeight: 42,
  legendGap: 14,
  barRadius: 7,
  scale: 2,
  font: "DejaVu Sans, sans-serif",
  fonts: { title: 25, label: 15, name: 12.5, day: 14, small: 11 },
  background: "#f5f7fb",
  panel: "#ffffff",
  ink: "#1e2940",
  secondary: "#52617a",
  grid: "#e7ebf2",
  weekend: "#f0f2f6",
  holiday: "#fbe5ed",
  today: "#405dd8",
  histogram: "#a2afca",
  employees: [
    ["#c9d5ff", "#2d4085"], ["#bfe6df", "#235b52"], ["#ead5f7", "#643c7c"],
    ["#ffdbc8", "#813e29"], ["#c8e1f6", "#26547a"], ["#dce9be", "#425d23"],
    ["#f5cfe0", "#803350"], ["#d7d5ef", "#4d487f"],
    ["#f2dfb7", "#745322"], ["#cbdcfa", "#315484"],
    ["#f4d8d8", "#794650"], ["#cce6ca", "#365f38"],
  ],
};

const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const rendererOptions = {
  font: { fontBuffers: [regularFont, boldFont], defaultFontFamily: "DejaVu Sans" },
};
let rendererReady: Promise<void> | undefined;

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function rect(x: number, y: number, width: number, height: number, fill: string, radius = 0): string {
  const rendering = radius === 0 ? ' shape-rendering="crispEdges"' : "";
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"${rendering}/>`;
}

function text(x: number, y: number, value: string, size: number, fill = style.ink, weight = 400, center = false): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}"${center ? ' text-anchor="middle"' : ""}>${escapeXml(value)}</text>`;
}

function employeeNameLines(name: string): string[] {
  const limit = 16;
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

function employeeNameText(lines: string[], x: number, y: number, size: number): string {
  const firstBaseline = y + (lines.length === 1 ? 23 : 15);
  return lines.map((line, index) => text(x, firstBaseline + index * 15, line, size, style.ink, 500)).join("");
}

function fittedNameSize(lines: string[], width: number): number {
  const size = style.fonts.name;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${style.rowHeight}" font-family="${style.font}">${employeeNameText(lines, 0, 0, size)}</svg>`;
  const label = new Resvg(svg, rendererOptions);
  try {
    const bounds = label.innerBBox();
    const right = bounds ? bounds.x + bounds.width : 0;
    bounds?.free();
    return right > width - 1 ? size * (width - 1) / right : size;
  } finally {
    label.free();
  }
}

export async function renderVacationTimeline(
  month: VacationMonth,
  profiles: ReadonlyMap<string, VacationProfile>,
  avatars = new VacationAvatarCache(),
): Promise<Buffer> {
  const { width, padding, nameWidth, rowHeight, headerHeight, histogramHeight, legendGap, fonts } = style;
  const nameLabelWidth = nameWidth - 47;
  const avatarLookupStartedAt = performance.now();
  let avatarLookupFinishedAt = avatarLookupStartedAt;
  const avatarDownloads: number[] = [];
  const employeeProfiles = Promise.all(month.employees.map(async (employee) => {
    const profile = profiles.get(employee.userId);
    const name = (profile?.name || employee.userId).replace(/\s+/g, " ").trim();
    const colorIndex = createHash("sha256").update(employee.userId).digest().readUInt32BE() % style.employees.length;
    const avatar = await avatars.get(profile?.avatarUrl, (durationMs) => avatarDownloads.push(durationMs));
    return { ...employee, name, color: style.employees[colorIndex], avatar };
  })).then((employees) => {
    avatarLookupFinishedAt = performance.now();
    if (employees.length > 0) {
      logger.info("Vacation timeline avatar timings", {
        month: month.month,
        avatarLookupMs: Math.round(avatarLookupFinishedAt - avatarLookupStartedAt),
        avatarDownloadAttempts: avatarDownloads.length,
        slowestAvatarDownloadMs: Math.round(Math.max(0, ...avatarDownloads)),
      });
    }
    return employees;
  });
  const [employees] = await Promise.all([employeeProfiles, rendererReady ??= initWasm(rendererWasm)]);
  const layoutStartedAt = performance.now();
  employees.sort((left, right) => left.name.localeCompare(right.name, "cs") || left.userId.localeCompare(right.userId));
  const employeeRows = employees.map((employee) => {
    const nameLines = employeeNameLines(employee.name);
    return { ...employee, nameLines, nameSize: fittedNameSize(nameLines, nameLabelWidth) };
  });

  const chartWidth = width - padding * 2;
  const dayWidth = (chartWidth - nameWidth) / month.days.length;
  const gridX = padding + nameWidth;
  const peak = Math.max(1, ...month.days.map((day) => day.away));
  const chartTop = 55;
  const bodyTop = chartTop + headerHeight;
  const histogramTop = bodyTop + Math.max(employeeRows.length, 1) * rowHeight;
  const chartBottom = histogramTop + histogramHeight;
  const baseline = chartBottom - 7;
  const chartHeight = chartBottom - chartTop;
  const elements = [
    text(padding, 39, month.label, fonts.title, style.ink, 650),
    rect(padding, chartTop, chartWidth, chartHeight, style.panel, 14),
    text(padding + 12, chartTop + 28, "Teammate", fonts.label, style.secondary, 600),
  ];

  for (const { day, weekday, holiday, away } of month.days) {
    const x = gridX + (day - 1) * dayWidth;
    const middle = x + dayWidth / 2;
    const weekend = weekday === 0 || weekday === 6;
    if (holiday || weekend) {
      elements.push(rect(x, chartTop + 6, dayWidth, chartHeight - 12, holiday ? style.holiday : style.weekend));
    }
    elements.push(rect(x, bodyTop, 1, baseline - bodyTop + 2, style.grid));
    if (day === month.today) {
      elements.push(rect(middle - 8.5, chartTop + 16, 17, 19, style.today, 5));
      elements.push(rect(middle - 0.75, bodyTop, 1.5, baseline - bodyTop + 2, style.today));
    }
    elements.push(text(middle, chartTop + 13, weekdays[weekday], fonts.small, style.secondary, 400, true));
    elements.push(text(middle, chartTop + 30, String(day), fonts.day, day === month.today ? style.panel : style.ink, 600, true));

    if (away > 0) {
      const barHeight = Math.round((away / peak) * 19) + 2;
      elements.push(rect(middle - 5, baseline - barHeight, 10, barHeight, style.histogram, 2));
      elements.push(text(middle, baseline - barHeight - 3, String(away), fonts.small, style.ink, 600, true));
    }
  }

  elements.push(rect(padding + 12, histogramTop, chartWidth - 24, 1, style.grid));
  elements.push(text(padding + 12, histogramTop + 26, "People away", fonts.label, style.secondary, 550));
  if (employeeRows.length === 0) elements.push(text(gridX + 8, bodyTop + 24, "No vacations", fonts.label, style.secondary));

  employeeRows.forEach(({ name, nameLines, nameSize, avatar, color, spans }, index) => {
    const top = bodyTop + index * rowHeight;
    const [fill, ink] = color;
    const nameX = padding + 43;
    const avatarX = padding + 12;
    const clipId = `employee-${index}`;
    const initials = name.split(" ").slice(0, 2).map((word) => [...word][0]).join("").toLocaleUpperCase();
    elements.push(rect(avatarX, top + 7, 22, 22, fill, 11));
    elements.push(text(avatarX + 11, top + 22, initials, fonts.small, ink, 650, true));
    if (avatar) {
      elements.push(`<clipPath id="${clipId}-avatar"><circle cx="${avatarX + 11}" cy="${top + 18}" r="11"/></clipPath>`);
      elements.push(`<image x="${avatarX}" y="${top + 7}" width="22" height="22" xlink:href="${avatar}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId}-avatar)"/>`);
    }
    elements.push(`<clipPath id="${clipId}">${rect(nameX - 1, top, nameLabelWidth + 1, rowHeight, style.panel)}</clipPath>`);
    elements.push(`<g clip-path="url(#${clipId})">${employeeNameText(nameLines, nameX, top, nameSize)}</g>`);

    for (const span of spans) {
      const from = Math.max(span.firstDay, 1);
      const to = Math.min(span.lastDay, month.days.length);
      if (from > to) continue;
      const left = gridX + (from - 1) * dayWidth + 2;
      const barWidth = (to - from + 1) * dayWidth - 4;
      elements.push(rect(left, top + 8, barWidth, 21, fill, style.barRadius));
      if (span.duration && barWidth >= 40) {
        elements.push(text(left + barWidth / 2, top + 23, `${span.duration}d`, fonts.small + 1, ink, 650, true));
      }
    }
  });

  const legendTop = chartBottom + legendGap;
  const legendItems = [
    { x: 0, color: style.employees[0][0], label: "Vacation" },
    { x: 100, color: style.weekend, label: "Weekend" },
    { x: 202, color: style.holiday, label: "Holiday" },
    { x: 298, color: style.today, label: "Today" },
  ];
  for (const item of legendItems) {
    elements.push(rect(padding + item.x, legendTop + 2, item.label === "Today" ? 2 : 14, 13, item.color, 2));
    elements.push(text(padding + item.x + (item.label === "Today" ? 8 : 20), legendTop + 14, item.label, fonts.label, style.secondary));
  }

  const height = legendTop + 29;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * style.scale}" height="${height * style.scale}" viewBox="0 0 ${width} ${height}" font-family="${style.font}">${rect(0, 0, width, height, style.background, 18)}${elements.join("")}</svg>`;
  const renderer = new Resvg(svg, rendererOptions);
  const rasterStartedAt = performance.now();
  let encoding: Promise<Buffer>;
  let encodingStartedAt: number;
  try {
    const image = renderer.render();
    try {
      encodingStartedAt = performance.now();
      encoding = encodeVacationPng(image.width, image.height, image.pixels);
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
  const png = await encoding;
  logger.info("Vacation timeline renderer timings", {
    month: month.month,
    wasmWaitMs: Math.round(layoutStartedAt - avatarLookupFinishedAt),
    svgLayoutMs: Math.round(rasterStartedAt - layoutStartedAt),
    rasterizeMs: Math.round(encodingStartedAt - rasterStartedAt),
    pngEncodeMs: Math.round(performance.now() - encodingStartedAt),
  });
  return png;
}
