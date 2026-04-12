export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  slackChannelId: string;
  timezone: string;
  postHour: number;
  postMinute: number;
  stateFilePath: string;
}

export interface HOMessageState {
  channelId: string;
  messageTs: string;
  targetDate: string;
  postedAt: string;
}

export interface StoredState {
  lastHoMessage: HOMessageState | null;
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