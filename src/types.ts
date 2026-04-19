export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  slackChannelId: string;
  timezone: string;
  postHour: number;
  postMinute: number;
  stateFilePath: string;
  teamMembers: string[];
}

export interface PlannedOutOfOffice {
  id: string; // Unique identifier
  userId: string;
  type: "ho" | "vacation";
  startDate: string; // ISO date YYYY-MM-DD
  endDate?: string; // ISO date YYYY-MM-DD, optional
}

export interface HOMessageState {
  channelId: string;
  messageTs: string;
  targetDate: string;
  postedAt: string;
  hoUsers?: string[];
  vacationUsers?: string[];
}

export interface StoredState {
  lastHoMessage: HOMessageState | null;
  plannedOutOfOffice: PlannedOutOfOffice[];
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoDate: string;
}

export interface RuntimeContext {
  botUserId: string;
}