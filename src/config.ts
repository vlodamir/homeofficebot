import path from "node:path";
import dotenv from "dotenv";
import { AppConfig } from "./types";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }

  return parsedValue;
}

function validateRange(name: string, value: number, min: number, max: number): number {
  if (value < min || value > max) {
    throw new Error(`Environment variable ${name} must be between ${min} and ${max}`);
  }

  return value;
}

export function loadConfig(): AppConfig {
  const postHour = validateRange("POST_HOUR", parseIntegerEnv("POST_HOUR", 18), 0, 23);
  const postMinute = validateRange("POST_MINUTE", parseIntegerEnv("POST_MINUTE", 0), 0, 59);
  const timezone = process.env.TIMEZONE?.trim() || "Europe/Prague";
  const stateFilePath = path.resolve(process.cwd(), process.env.STATE_FILE_PATH?.trim() || "data/state.json");

  return {
    slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv("SLACK_APP_TOKEN"),
    slackChannelId: requireEnv("SLACK_CHANNEL_ID"),
    timezone,
    postHour,
    postMinute,
    stateFilePath,
  };
}

export function getCronExpression(config: AppConfig): string {
  return `${config.postMinute} ${config.postHour} * * *`;
}