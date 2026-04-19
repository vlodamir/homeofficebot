import path from "node:path";
import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { AppConfig } from "./types";

function getConfigFilePath(): string {
  const configFlag = process.argv.find((arg) => arg.startsWith("--config="));
  if (configFlag) {
    return configFlag.replace("--config=", "");
  }

  // Check for --config with separate value
  const configIndex = process.argv.indexOf("--config");
  if (configIndex !== -1 && configIndex + 1 < process.argv.length) {
    return process.argv[configIndex + 1];
  }

  throw new Error(
    "Configuration file path not provided. Please use: --config /path/to/config.yaml"
  );
}

function requireField(config: Record<string, unknown>, field: string): string {
  const value = config[field];

  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required configuration field: ${field}`);
  }

  return value.trim();
}

function parseIntegerField(config: Record<string, unknown>, field: string, fallback: number): number {
  const value = config[field];

  if (value === undefined || value === null) {
    return fallback;
  }

  const parsedValue = typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(`Configuration field ${field} must be an integer`);
  }

  return parsedValue;
}

function validateRange(field: string, value: number, min: number, max: number): number {
  if (value < min || value > max) {
    throw new Error(`Configuration field ${field} must be between ${min} and ${max}`);
  }

  return value;
}

export function loadConfig(): AppConfig {
  const configPath = getConfigFilePath();
  const absoluteConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(absoluteConfigPath)) {
    throw new Error(`Configuration file not found: ${absoluteConfigPath}`);
  }

  const fileContent = fs.readFileSync(absoluteConfigPath, "utf-8");
  const config = parseYaml(fileContent) as Record<string, unknown>;

  if (!config || typeof config !== "object") {
    throw new Error("Invalid YAML configuration file");
  }

  const postHour = validateRange(
    "postHour",
    parseIntegerField(config, "postHour", 18),
    0,
    23
  );
  const postMinute = validateRange(
    "postMinute",
    parseIntegerField(config, "postMinute", 0),
    0,
    59
  );
  const timezone = (config.timezone as string) || "Europe/Prague";
  const stateFilePath = path.resolve(
    process.cwd(),
    (config.stateFilePath as string) || "data/state.json"
  );
  const teamMembers = (config.teamMembers as string[]) || [];

  return {
    slackBotToken: requireField(config, "slackBotToken"),
    slackAppToken: requireField(config, "slackAppToken"),
    slackChannelId: requireField(config, "slackChannelId"),
    timezone,
    postHour,
    postMinute,
    stateFilePath,
    teamMembers,
  };
}

export function getCronExpression(config: AppConfig): string {
  return `${config.postMinute} ${config.postHour} * * *`;
}