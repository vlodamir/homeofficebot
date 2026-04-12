type LogLevel = "INFO" | "WARN" | "ERROR";

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const serializedMeta = meta === undefined ? "" : ` ${JSON.stringify(meta)}`;
  return `[${timestamp}] [${level}] ${message}${serializedMeta}`;
}

export const logger = {
  info(message: string, meta?: unknown): void {
    console.log(formatMessage("INFO", message, meta));
  },

  warn(message: string, meta?: unknown): void {
    console.warn(formatMessage("WARN", message, meta));
  },

  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      console.error(
        formatMessage("ERROR", message, {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }),
      );
      return;
    }

    console.error(formatMessage("ERROR", message, error));
  },
};