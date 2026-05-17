'use strict';

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const DB_DIR  = path.join(os.homedir(), 'Library', 'Application Support', 'PlugPilot');
const DB_PATH = path.join(DB_DIR, 'history.db');

let _db: any = null;

function getDb(): any {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const Database = require('better-sqlite3');
  _db = new Database(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS action_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        TEXT    NOT NULL,
      action    TEXT    NOT NULL,
      triggered TEXT    NOT NULL DEFAULT 'manual',
      battery   INTEGER,
      success   INTEGER NOT NULL DEFAULT 1,
      note      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ts ON action_log(ts DESC);
  `);
  return _db;
}

export interface ActionRow {
  id: number;
  ts: string;
  action: string;
  triggered: 'manual' | 'monitor';
  battery: number | null;
  success: 0 | 1;
  note: string | null;
}

export function logAction(opts: {
  action: string;
  triggered?: 'manual' | 'monitor';
  battery?: number | null;
  success?: boolean;
  note?: string;
}): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO action_log (ts, action, triggered, battery, success, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      opts.action,
      opts.triggered ?? 'manual',
      opts.battery ?? null,
      opts.success === false ? 0 : 1,
      opts.note ?? null
    );
  } catch (e: any) {
    // Non-fatal — don't break the main flow
    console.error('[historydb] logAction failed:', e.message);
  }
}

export function getHistory(limit = 200): ActionRow[] {
  try {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM action_log ORDER BY ts DESC LIMIT ?'
    ).all(limit) as ActionRow[];
  } catch (e: any) {
    console.error('[historydb] getHistory failed:', e.message);
    return [];
  }
}

export function clearHistory(): void {
  try {
    const db = getDb();
    db.prepare('DELETE FROM action_log').run();
  } catch (e: any) {
    console.error('[historydb] clearHistory failed:', e.message);
  }
}

export function closeDb(): void {
  try {
    if (_db) {
      _db.close();
      _db = null;
    }
  } catch (e: any) {
    console.error('[historydb] closeDb failed:', e.message);
  }
}

export { DB_PATH, DB_DIR };
