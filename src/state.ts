import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";
import { HOMessageState, StoredState, WeeklyHoTracking } from "./types";

const DEFAULT_STATE: StoredState = {
  lastHoMessage: null,
  weeklyTracking: null,
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
        weeklyTracking: parsed.weeklyTracking ?? null,
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
      ...this.state,
      lastHoMessage: message,
    };

    await this.save();
  }

  getWeeklyTracking(): WeeklyHoTracking | null {
    return this.state.weeklyTracking;
  }

  async setWeeklyTracking(tracking: WeeklyHoTracking | null): Promise<void> {
    this.state = {
      ...this.state,
      weeklyTracking: tracking,
    };

    await this.save();
  }

  async incrementWeeklyHoCount(weekStart: string, userName: string): Promise<void> {
    let tracking = this.state.weeklyTracking;

    if (!tracking || tracking.weekStart !== weekStart) {
      tracking = {
        weekStart,
        userHoCounts: {},
      };
    }

    tracking.userHoCounts[userName] = (tracking.userHoCounts[userName] ?? 0) + 1;

    this.state = {
      ...this.state,
      weeklyTracking: tracking,
    };

    await this.save();
  }

  async decrementWeeklyHoCount(weekStart: string, userName: string): Promise<void> {
    let tracking = this.state.weeklyTracking;

    if (!tracking || tracking.weekStart !== weekStart) {
      logger.warn("Attempted to decrement HO count for non-existent week", {
        weekStart,
        userName,
      });
      return;
    }

    const currentCount = tracking.userHoCounts[userName] ?? 0;

    if (currentCount <= 0) {
      logger.warn("Attempted to decrement HO count below zero", {
        weekStart,
        userName,
        currentCount,
      });
      return;
    }

    tracking.userHoCounts[userName] = currentCount - 1;

    // Remove user from tracking if count reaches zero
    if (tracking.userHoCounts[userName] === 0) {
      delete tracking.userHoCounts[userName];
    }

    this.state = {
      ...this.state,
      weeklyTracking: tracking,
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