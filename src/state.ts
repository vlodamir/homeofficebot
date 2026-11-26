import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readLegacyState } from "./legacyState";
import { logger } from "./logger";
import type { HOMessageState, PlannedOutOfOffice } from "./types";

export type AttendanceVote = "onsite" | "ho" | "vacation";

type MessageIdentity = Pick<HOMessageState, "channelId" | "messageTs">;
type MessageVoteRow = Required<Omit<HOMessageState, "confirmedOnsiteUsers" | "hoUsers" | "vacationUsers">> & {
  userId: string | null;
  status: AttendanceVote | null;
};
type AbsenceRow = Omit<PlannedOutOfOffice, "endDate"> & { endDate: string | null };

const schemaVersion = 1;

const schema = `
  CREATE TABLE last_ho_message (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT NOT NULL,
    message_ts TEXT NOT NULL,
    target_date TEXT NOT NULL,
    posted_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE attendance_votes (
    message_id INTEGER NOT NULL DEFAULT 1 REFERENCES last_ho_message(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('onsite', 'ho', 'vacation')),
    PRIMARY KEY (message_id, user_id, status)
  ) STRICT;

  CREATE TABLE team_members (
    user_id TEXT PRIMARY KEY
  ) STRICT;

  CREATE TABLE planned_absences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ho', 'vacation')),
    start_date TEXT NOT NULL,
    end_date TEXT
  ) STRICT;

  CREATE INDEX planned_absences_user_start ON planned_absences (user_id, start_date);
  CREATE INDEX planned_absences_end ON planned_absences (end_date);
  CREATE INDEX planned_absences_type_end ON planned_absences (type, end_date);
`;

const absenceColumns = "id, user_id AS userId, type, start_date AS startDate, end_date AS endDate";

function toPlannedEntry(row: AbsenceRow): PlannedOutOfOffice {
  return { ...row, endDate: row.endDate ?? undefined };
}

export class StateStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(databasePath: string, legacyPath?: string): StateStore {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const stateStore = new StateStore(new DatabaseSync(databasePath, { enableForeignKeyConstraints: true }));
    try {
      stateStore.db.exec("PRAGMA busy_timeout = 1000");
      stateStore.initialize(legacyPath);
      return stateStore;
    } catch (error) {
      stateStore.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private initialize(legacyPath?: string): void {
    const imported = this.transaction(() => {
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version === schemaVersion) return undefined;
      if (version !== 0) throw new Error(`Unsupported state database schema version: ${version}`);

      const legacy = legacyPath ? readLegacyState(legacyPath) : undefined;
      this.db.exec(schema);
      if (legacy) {
        this.writeLastHoMessage(legacy.lastHoMessage);
        this.insertTeamMembers(legacy.teamMembers);
        for (const entry of legacy.plannedOutOfOffice) {
          this.insertAbsence(entry);
        }
      }
      this.db.exec(`PRAGMA user_version = ${schemaVersion}`);
      return legacy && {
        plannedAbsences: legacy.plannedOutOfOffice.length,
        teamMembers: legacy.teamMembers.length,
        hasLastHoMessage: legacy.lastHoMessage !== null,
      };
    });

    if (imported) logger.info("Imported legacy state into SQLite", { legacyPath, ...imported });
  }

  private transaction<T>(write: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        logger.error("Could not roll back state transaction", rollbackError);
      }
      throw error;
    }
  }

  getLastHoMessage(): HOMessageState | null {
    const rows = this.db.prepare(`
      SELECT channel_id AS channelId, message_ts AS messageTs, target_date AS targetDate,
             posted_at AS postedAt, user_id AS userId, status
      FROM last_ho_message
      LEFT JOIN attendance_votes ON attendance_votes.message_id = last_ho_message.id
      ORDER BY attendance_votes.rowid
    `).all() as MessageVoteRow[];
    const message = rows[0];
    if (!message) return null;

    const votes: Record<AttendanceVote, string[]> = { onsite: [], ho: [], vacation: [] };
    for (const row of rows) {
      if (row.status !== null && row.userId !== null) votes[row.status].push(row.userId);
    }
    return {
      channelId: message.channelId,
      messageTs: message.messageTs,
      targetDate: message.targetDate,
      postedAt: message.postedAt,
      confirmedOnsiteUsers: votes.onsite,
      hoUsers: votes.ho,
      vacationUsers: votes.vacation,
    };
  }

  setLastHoMessage(message: HOMessageState | null): void {
    this.transaction(() => this.writeLastHoMessage(message));
  }

  private writeLastHoMessage(message: HOMessageState | null): void {
    this.db.exec("DELETE FROM last_ho_message");
    if (!message) return;

    this.db.prepare(`
      INSERT INTO last_ho_message (id, channel_id, message_ts, target_date, posted_at)
      VALUES (1, ?, ?, ?, ?)
    `).run(message.channelId, message.messageTs, message.targetDate, message.postedAt);

    const votes: Record<AttendanceVote, string[]> = {
      onsite: message.confirmedOnsiteUsers ?? [],
      ho: message.hoUsers ?? [],
      vacation: message.vacationUsers ?? [],
    };
    const insert = this.db.prepare(`
      INSERT INTO attendance_votes (user_id, status) VALUES (?, ?)
      ON CONFLICT (message_id, user_id, status) DO NOTHING
    `);
    for (const [status, users] of Object.entries(votes)) {
      for (const userId of users) insert.run(userId, status);
    }
  }

  private clearVotes(userId: string): void {
    this.db.prepare("DELETE FROM attendance_votes WHERE user_id = ?").run(userId);
  }

  private replaceVote(userId: string, status: AttendanceVote | null): void {
    this.clearVotes(userId);
    if (status) {
      this.db.prepare("INSERT INTO attendance_votes (user_id, status) VALUES (?, ?)").run(userId, status);
    }
  }

  setAttendanceVote(userId: string, status: AttendanceVote | null): boolean {
    return this.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM last_ho_message").get()) return false;
      this.replaceVote(userId, status);
      return true;
    });
  }

  toggleAttendanceVote(message: MessageIdentity, userId: string, status: AttendanceVote): "updated" | "planned" | "stale" {
    return this.transaction(() => {
      const target = this.db.prepare(`
        SELECT target_date FROM last_ho_message WHERE channel_id = ? AND message_ts = ?
      `).get(message.channelId, message.messageTs);
      if (!target) return "stale";

      const targetDate = target.target_date as string;
      const absence = this.db.prepare(`
        SELECT 1 FROM planned_absences
        WHERE user_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
        LIMIT 1
      `).get(userId, targetDate, targetDate);
      if (absence) return "planned";

      const removed = this.db.prepare("DELETE FROM attendance_votes WHERE user_id = ? AND status = ?")
        .run(userId, status);
      if (removed.changes === 0) this.replaceVote(userId, status);
      return "updated";
    });
  }

  getTeamMembers(): string[] {
    return this.db.prepare("SELECT user_id FROM team_members ORDER BY rowid").all().map((row) => row.user_id as string);
  }

  private insertTeamMembers(userIds: string[]): void {
    const insert = this.db.prepare("INSERT INTO team_members (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING");
    for (const userId of userIds) insert.run(userId);
  }

  setTeamMembers(userIds: string[], today: string): void {
    this.transaction(() => {
      const previousMembers = this.getTeamMembers();
      const remainingMembers = new Set(userIds);
      const removeFuture = this.db.prepare("DELETE FROM planned_absences WHERE user_id = ? AND start_date >= ?");
      const shortenOngoing = this.db.prepare(`
        UPDATE planned_absences SET end_date = date(?, '-1 day')
        WHERE user_id = ? AND start_date < ? AND (end_date IS NULL OR end_date >= ?)
      `);
      for (const userId of previousMembers) {
        if (remainingMembers.has(userId)) continue;
        removeFuture.run(userId, today);
        shortenOngoing.run(today, userId, today, today);
      }

      this.db.exec("DELETE FROM team_members");
      this.insertTeamMembers(userIds);
      this.db.exec("DELETE FROM attendance_votes WHERE user_id NOT IN (SELECT user_id FROM team_members)");
    });
  }

  getPlannedOutOfOfficeOn(date: string): PlannedOutOfOffice[] {
    const rows = this.db.prepare(`
      SELECT ${absenceColumns} FROM planned_absences
      WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)
      ORDER BY rowid
    `).all(date, date) as AbsenceRow[];
    return rows.map(toPlannedEntry);
  }

  getUpcomingPlannedOutOfOffice(today: string, userId?: string): PlannedOutOfOffice[] {
    const onlyUser = userId === undefined ? "" : "AND user_id = ?";
    const parameters = userId === undefined ? [today] : [today, userId];
    const rows = this.db.prepare(`
      SELECT ${absenceColumns} FROM planned_absences
      WHERE (end_date IS NULL OR end_date >= ?) ${onlyUser}
      ORDER BY rowid
    `).all(...parameters) as AbsenceRow[];
    return rows.map(toPlannedEntry);
  }

  getVacationsInRange(start: string, endExclusive: string): PlannedOutOfOffice[] {
    const rows = this.db.prepare(`
      SELECT ${absenceColumns} FROM planned_absences
      WHERE type = 'vacation' AND start_date < ? AND (end_date IS NULL OR end_date >= ?)
    `).all(endExclusive, start) as AbsenceRow[];
    return rows.map(toPlannedEntry);
  }

  tryAddPlannedOutOfOffice(entry: PlannedOutOfOffice): PlannedOutOfOffice | undefined {
    return this.transaction(() => {
      const endDate = entry.endDate ?? null;
      const overlap = this.db.prepare(`
        SELECT ${absenceColumns} FROM planned_absences
        WHERE user_id = ? AND (? IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)
        ORDER BY rowid LIMIT 1
      `).get(entry.userId, endDate, endDate, entry.startDate) as AbsenceRow | undefined;
      if (overlap) return toPlannedEntry(overlap);

      this.insertAbsence(entry);
      const affectsTrackedMessage = this.db.prepare(`
        SELECT 1 FROM last_ho_message
        WHERE target_date >= ? AND (? IS NULL OR target_date <= ?)
      `).get(entry.startDate, endDate, endDate);
      if (affectsTrackedMessage) this.clearVotes(entry.userId);
      return undefined;
    });
  }

  private insertAbsence(entry: PlannedOutOfOffice): void {
    this.db.prepare(`
      INSERT INTO planned_absences (id, user_id, type, start_date, end_date) VALUES (?, ?, ?, ?, ?)
    `).run(entry.id, entry.userId, entry.type, entry.startDate, entry.endDate ?? null);
  }

  removePlannedOutOfOffice(id: string, today: string, userId?: string): boolean {
    const onlyUser = userId === undefined ? "" : "AND user_id = ?";
    const parameters = userId === undefined ? [id, today] : [id, today, userId];
    const result = this.db.prepare(`
      DELETE FROM planned_absences
      WHERE id = ? AND (end_date IS NULL OR end_date >= ?) ${onlyUser}
    `).run(...parameters);
    return result.changes > 0;
  }
}
