import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";
import { HOMessageState, StoredState } from "./types";

const DEFAULT_STATE: StoredState = {
  lastHoMessage: null,
};

export class StateStore {
  private state: StoredState = DEFAULT_STATE;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredState;

      this.state = {
        lastHoMessage: parsed.lastHoMessage ?? null,
      };

      logger.info("State loaded", this.state);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;

      if (nodeError.code === "ENOENT") {
        this.state = DEFAULT_STATE;
        logger.info("State file not found, starting with empty state", { filePath: this.filePath });
        return;
      }

      logger.error("Failed to load state file", error);
      throw error;
    }
  }

  getLastHoMessage(): HOMessageState | null {
    return this.state.lastHoMessage;
  }

  async setLastHoMessage(message: HOMessageState | null): Promise<void> {
    this.state = {
      lastHoMessage: message,
    };

    await this.save();
  }

  private async save(): Promise<void> {
    const directoryPath = path.dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;

    await fs.mkdir(directoryPath, { recursive: true });
    await fs.writeFile(tempFilePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await fs.rename(tempFilePath, this.filePath);
  }
}