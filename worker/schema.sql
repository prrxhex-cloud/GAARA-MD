-- Cloudflare D1 Database Schema for ofc-database (GAARA X MD)
-- Database ID: 863d050f-0ee6-488c-adb9-28a082e99f2c

CREATE TABLE IF NOT EXISTS user_settings (
    phone TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_schedules (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    jid TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'daily',
    time TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_replies (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    trigger TEXT NOT NULL,
    response TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'contains',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_schedules_phone ON user_schedules(phone);
CREATE INDEX IF NOT EXISTS idx_user_replies_phone ON user_replies(phone);
