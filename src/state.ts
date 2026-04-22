import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";
import { HOMessageState, StoredState, PlannedOutOfOffice } from "./types";

const DEFAULT_STATE: StoredState = {
  lastHoMessage: null,
  plannedOutOfOffice: [],
};

export class StateStore {
  private state: StoredState = DEFAULT_STATE;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredState;

      // Ensure all planned out of office entries have IDs (migration for existing entries)
      const plannedEntries = (parsed.plannedOutOfOffice ?? []).map((entry: any) => ({
        id: entry.id || randomUUID(),
        userId: entry.userId,
        type: entry.type,
        startDate: entry.startDate,
        endDate: entry.endDate,
      }));

      this.state = {
        lastHoMessage: parsed.lastHoMessage ?? null,
        plannedOutOfOffice: plannedEntries,
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
      lastHoMessage: message ? { ...message, hoUsers: message.hoUsers ?? [], vacationUsers: message.vacationUsers ?? [] } : null,
      plannedOutOfOffice: this.state.plannedOutOfOffice ?? [],
    };

    await this.save();
  }

  addConfirmedOnsiteUser(userId: string): void {
    if (this.state.lastHoMessage) {
      const confirmedOnsiteUsers = this.state.lastHoMessage.confirmedOnsiteUsers ?? [];
      if (!confirmedOnsiteUsers.includes(userId)) {
        confirmedOnsiteUsers.push(userId);
        this.state.lastHoMessage.confirmedOnsiteUsers = confirmedOnsiteUsers;
      }
    }
  }

  removeConfirmedOnsiteUser(userId: string): void {
    if (this.state.lastHoMessage) {
      const confirmedOnsiteUsers = this.state.lastHoMessage.confirmedOnsiteUsers ?? [];
      const index = confirmedOnsiteUsers.indexOf(userId);
      if (index > -1) {
        confirmedOnsiteUsers.splice(index, 1);
        this.state.lastHoMessage.confirmedOnsiteUsers = confirmedOnsiteUsers;
      }
    }
  }

  addHoUser(userId: string): void {
    if (this.state.lastHoMessage) {
      const hoUsers = this.state.lastHoMessage.hoUsers ?? [];
      if (!hoUsers.includes(userId)) {
        hoUsers.push(userId);
        this.state.lastHoMessage.hoUsers = hoUsers;
      }
    }
  }

  removeHoUser(userId: string): void {
    if (this.state.lastHoMessage) {
      const hoUsers = this.state.lastHoMessage.hoUsers ?? [];
      const index = hoUsers.indexOf(userId);
      if (index > -1) {
        hoUsers.splice(index, 1);
        this.state.lastHoMessage.hoUsers = hoUsers;
      }
    }
  }

  addVacationUser(userId: string): void {
    if (this.state.lastHoMessage) {
      const vacationUsers = this.state.lastHoMessage.vacationUsers ?? [];
      if (!vacationUsers.includes(userId)) {
        vacationUsers.push(userId);
        this.state.lastHoMessage.vacationUsers = vacationUsers;
      }
    }
  }

  removeVacationUser(userId: string): void {
    if (this.state.lastHoMessage) {
      const vacationUsers = this.state.lastHoMessage.vacationUsers ?? [];
      const index = vacationUsers.indexOf(userId);
      if (index > -1) {
        vacationUsers.splice(index, 1);
        this.state.lastHoMessage.vacationUsers = vacationUsers;
      }
    }
  }

  getPlannedOutOfOffice(): PlannedOutOfOffice[] {
    return this.state.plannedOutOfOffice ?? [];
  }

  addPlannedOutOfOffice(entry: PlannedOutOfOffice): void {
    if (!this.state.plannedOutOfOffice) {
      this.state.plannedOutOfOffice = [];
    }
    this.state.plannedOutOfOffice.push(entry);
  }

  removePlannedOutOfOffice(id: string): void {
    if (this.state.plannedOutOfOffice) {
      this.state.plannedOutOfOffice = this.state.plannedOutOfOffice.filter(entry => entry.id !== id);
    }
  }

  cleanupExpiredPlannedOutOfOffice(today: string): boolean {
    const beforeLength = this.state.plannedOutOfOffice?.length ?? 0;
    
    this.state.plannedOutOfOffice = (this.state.plannedOutOfOffice ?? []).filter((entry) => {
      // Never clean up entries without an end date (keep indefinitely until manually deleted)
      if (!entry.endDate) {
        return true;
      }
      // Clean up entries where the end date has passed
      return entry.endDate >= today;
    });

    return beforeLength !== this.state.plannedOutOfOffice.length;
  }

  async saveState(): Promise<void> {
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