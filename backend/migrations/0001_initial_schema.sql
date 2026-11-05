-- Migration number: 0001 	 2026-11-04T18:43:41.297Z


CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE
    CHECK (substr(phone_e164, 1, 1) = '+'),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  display_name TEXT,
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE inbound_messages (
  message_sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  intent TEXT NOT NULL
    CHECK (intent IN ('create', 'list', 'cancel', 'help', 'stop', 'start', 'unknown')),
  parsed_json TEXT CHECK (parsed_json IS NULL OR json_valid(parsed_json)),
  reply_text TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_message_sid TEXT UNIQUE
    REFERENCES inbound_messages(message_sid) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 320),
  remind_at INTEGER NOT NULL,
  recurrence TEXT
    CHECK (recurrence IN ('daily', 'weekly', 'monthly')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until INTEGER,
  sent_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE delivery_attempts (
  id INTEGER PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  twilio_sid TEXT UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'sent', 'delivered', 'undelivered', 'failed', 'error')),
  error_code INTEGER,
  attempted_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_codes (
  phone_e164 TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 5),
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_reminders_due
  ON reminders(status, remind_at);
CREATE INDEX idx_reminders_user
  ON reminders(user_id, remind_at);
CREATE INDEX idx_delivery_reminder
  ON delivery_attempts(reminder_id);
CREATE INDEX idx_inbound_user
  ON inbound_messages(user_id, received_at);
CREATE INDEX idx_sessions_user
  ON sessions(user_id);