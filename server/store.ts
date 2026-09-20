import type { DatabaseSync } from "node:sqlite";
import type { LedgerEvent, LedgerEventPayload, LedgerEventType } from "@shared/domain";

export interface NewEvent {
  type: LedgerEventType;
  actorIdentityId: string | null;
  payload: LedgerEventPayload;
  createdAt?: number;
}

interface EventRow {
  seq: number;
  type: string;
  actor_identity_id: string | null;
  payload: string;
  created_at: number;
}

export interface ActivityRow {
  id: string;
  createdAt: number;
  adminPasswordHash: string | null;
}

export class EventStore {
  constructor(private readonly db: DatabaseSync) {}

  getActivity(activityId: string): ActivityRow | null {
    const row = this.db
      .prepare("SELECT id, created_at, admin_password_hash FROM activities WHERE id = ?")
      .get(activityId) as
      | { id: string; created_at: number; admin_password_hash: string | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      createdAt: row.created_at,
      adminPasswordHash: row.admin_password_hash,
    };
  }

  createActivity(activityId: string, createdAt: number, payload: LedgerEventPayload): void {
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO activities (id, created_at, admin_password_hash) VALUES (?, ?, NULL)")
        .run(activityId, createdAt);
      this.appendInternal(activityId, [
        { type: "activity.created", actorIdentityId: null, payload, createdAt },
      ]);
    });
  }

  setAdminPasswordHash(activityId: string, hash: string | null): void {
    this.db
      .prepare("UPDATE activities SET admin_password_hash = ? WHERE id = ?")
      .run(hash, activityId);
  }

  maxSeq(activityId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE activity_id = ?")
      .get(activityId) as { max_seq: number } | undefined;
    return row?.max_seq ?? 0;
  }

  loadEvents(activityId: string): LedgerEvent[] {
    const rows = this.db
      .prepare(
        "SELECT seq, type, actor_identity_id, payload, created_at FROM events WHERE activity_id = ? ORDER BY seq ASC",
      )
      .all(activityId) as unknown as EventRow[];

    return rows.map((row) => ({
      seq: row.seq,
      type: row.type as LedgerEventType,
      actorIdentityId: row.actor_identity_id,
      payload: JSON.parse(row.payload),
      createdAt: row.created_at,
    }));
  }

  append(activityId: string, events: NewEvent[]): LedgerEvent[] {
    if (events.length === 0) return [];
    let appended: LedgerEvent[] = [];
    this.transaction(() => {
      appended = this.appendInternal(activityId, events);
    });
    return appended;
  }

  private appendInternal(activityId: string, events: NewEvent[]): LedgerEvent[] {
    let seq = this.maxSeq(activityId);
    const inserted: LedgerEvent[] = [];
    const statement = this.db.prepare(
      "INSERT INTO events (activity_id, seq, type, actor_identity_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    for (const event of events) {
      seq += 1;
      const createdAt = event.createdAt ?? Date.now();
      const payload = JSON.stringify(event.payload);
      statement.run(activityId, seq, event.type, event.actorIdentityId, payload, createdAt);
      inserted.push({
        seq,
        type: event.type,
        actorIdentityId: event.actorIdentityId,
        payload: event.payload,
        createdAt,
      });
    }
    return inserted;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
