import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { HOMessageState, PlannedOutOfOffice } from "./types";

interface LegacyState {
  lastHoMessage: HOMessageState | null;
  plannedOutOfOffice: PlannedOutOfOffice[];
  teamMembers: string[];
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a nonempty string`);
  }
  return value;
}

function date(value: unknown, field: string): string {
  const text = string(value, field);
  const timestamp = Date.parse(text);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw new Error(`${field} must be an ISO calendar date`);
  }
  return text;
}

function array(value: unknown, field: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function userIds(value: unknown, field: string): string[] {
  return array(value, field).map((id, index) => string(id, `${field}[${index}]`));
}

function parseLastHoMessage(value: unknown): HOMessageState | null {
  if (value == null) return null;
  const message = object(value, "lastHoMessage");
  return {
    channelId: string(message.channelId, "lastHoMessage.channelId"),
    messageTs: string(message.messageTs, "lastHoMessage.messageTs"),
    targetDate: date(message.targetDate, "lastHoMessage.targetDate"),
    postedAt: string(message.postedAt, "lastHoMessage.postedAt"),
    confirmedOnsiteUsers: userIds(message.confirmedOnsiteUsers, "lastHoMessage.confirmedOnsiteUsers"),
    hoUsers: userIds(message.hoUsers, "lastHoMessage.hoUsers"),
    vacationUsers: userIds(message.vacationUsers, "lastHoMessage.vacationUsers"),
  };
}

function parsePlannedEntry(value: unknown, index: number): PlannedOutOfOffice {
  const field = `plannedOutOfOffice[${index}]`;
  const entry = object(value, field);
  if (entry.type !== "ho" && entry.type !== "vacation") {
    throw new Error(`${field}.type must be ho or vacation`);
  }
  return {
    id: entry.id == null || entry.id === "" ? randomUUID() : string(entry.id, `${field}.id`),
    userId: string(entry.userId, `${field}.userId`),
    type: entry.type,
    startDate: date(entry.startDate, `${field}.startDate`),
    endDate: entry.endDate == null || entry.endDate === "" ? undefined : date(entry.endDate, `${field}.endDate`),
  };
}

export function readLegacyState(filePath: string): LegacyState | undefined {
  try {
    const state = object(JSON.parse(readFileSync(filePath, "utf8")), "State");
    return {
      lastHoMessage: parseLastHoMessage(state.lastHoMessage),
      plannedOutOfOffice: array(state.plannedOutOfOffice, "plannedOutOfOffice").map(parsePlannedEntry),
      teamMembers: userIds(state.teamMembers, "teamMembers"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not import legacy state from ${filePath}. ${message}`, { cause: error });
  }
}
