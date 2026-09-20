import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_DB_PATH = "data/ledger.db";

export function openDatabase(path: string = process.env.LEDGER_DB ?? DEFAULT_DB_PATH): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      admin_password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor_identity_id TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (activity_id, seq)
    );
  `);
}
