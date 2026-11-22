const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'reminder_saas.db');
const db = new DatabaseSync(dbPath);

// Enable WAL and foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    voice_quota_used INTEGER NOT NULL DEFAULT 0,
    voice_quota_limit INTEGER NOT NULL DEFAULT 5,
    reminder_limit INTEGER NOT NULL DEFAULT 10,
    quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
    quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
    quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
    escalation_whatsapp INTEGER NOT NULL DEFAULT 0,
    escalation_sms INTEGER NOT NULL DEFAULT 0,
    escalation_email INTEGER NOT NULL DEFAULT 1,
    phone_number TEXT DEFAULT '',
    streak_days INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    raw_input TEXT NOT NULL,
    input_type TEXT NOT NULL DEFAULT 'text',
    audio_url TEXT,
    audio_duration INTEGER DEFAULT 0,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'medium',
    category TEXT NOT NULL DEFAULT 'general',
    snooze_count INTEGER NOT NULL DEFAULT 0,
    repeat_rule TEXT DEFAULT 'none',
    action_link TEXT DEFAULT '',
    location_trigger TEXT DEFAULT '',
    subtasks_json TEXT DEFAULT '[]',
    assigned_to_email TEXT DEFAULT '',
    require_proof INTEGER NOT NULL DEFAULT 0,
    tts_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reminder_logs (
    id TEXT PRIMARY KEY,
    reminder_id TEXT,
    user_id TEXT NOT NULL,
    reminder_title TEXT NOT NULL,
    input_type TEXT NOT NULL DEFAULT 'text',
    audio_url TEXT,
    action TEXT NOT NULL,
    details TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Safe migrations for existing database tables
function safeAddColumn(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
  } catch (e) {
    // Column already exists
  }
}

safeAddColumn('users', "quiet_hours_enabled INTEGER NOT NULL DEFAULT 0");
safeAddColumn('users', "quiet_hours_start TEXT NOT NULL DEFAULT '22:00'");
safeAddColumn('users', "quiet_hours_end TEXT NOT NULL DEFAULT '08:00'");
safeAddColumn('users', "escalation_whatsapp INTEGER NOT NULL DEFAULT 0");
safeAddColumn('users', "escalation_sms INTEGER NOT NULL DEFAULT 0");
safeAddColumn('users', "escalation_email INTEGER NOT NULL DEFAULT 1");
safeAddColumn('users', "phone_number TEXT DEFAULT ''");
safeAddColumn('users', "streak_days INTEGER NOT NULL DEFAULT 1");

safeAddColumn('reminders', "category TEXT NOT NULL DEFAULT 'general'");
safeAddColumn('reminders', "action_link TEXT DEFAULT ''");
safeAddColumn('reminders', "location_trigger TEXT DEFAULT ''");
safeAddColumn('reminders', "subtasks_json TEXT DEFAULT '[]'");
safeAddColumn('reminders', "assigned_to_email TEXT DEFAULT ''");
safeAddColumn('reminders', "require_proof INTEGER NOT NULL DEFAULT 0");
safeAddColumn('reminders', "tts_enabled INTEGER NOT NULL DEFAULT 1");

module.exports = db;
