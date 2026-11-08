CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  phone_e164 TEXT UNIQUE
    CHECK (substr(phone_e164, 1, 1) = '+'),
  google_subject TEXT UNIQUE
    CHECK (length(google_subject) > 0),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  display_name TEXT,
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (phone_e164 IS NOT NULL OR google_subject IS NOT NULL)
);

CREATE TABLE inbound_messages_new (
  message_sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  intent TEXT NOT NULL
    CHECK (intent IN ('create', 'list', 'cancel', 'help', 'stop', 'start', 'unknown')),
  parsed_json TEXT CHECK (parsed_json IS NULL OR json_valid(parsed_json)),
  reply_text TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE reminders_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  source_message_sid TEXT UNIQUE
    REFERENCES inbound_messages_new(message_sid) ON DELETE SET NULL,
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

CREATE TABLE delivery_attempts_new (
  id INTEGER PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders_new(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  twilio_sid TEXT UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'sent', 'delivered', 'undelivered', 'failed', 'error')),
  error_code INTEGER,
  attempted_at INTEGER NOT NULL
);

CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

INSERT INTO users_new (id, phone_e164, timezone, display_name, opted_out, created_at, updated_at)
SELECT id, phone_e164, timezone, display_name, opted_out, created_at, updated_at
FROM users;

INSERT INTO inbound_messages_new (message_sid, user_id, body, intent, parsed_json, reply_text, received_at)
SELECT message_sid, user_id, body, intent, parsed_json, reply_text, received_at
FROM inbound_messages;

INSERT INTO reminders_new (
  id, user_id, source_message_sid, body, remind_at, recurrence, status,
  attempts, locked_until, sent_at, created_at, updated_at
)
SELECT id, user_id, source_message_sid, body, remind_at, recurrence, status,
  attempts, locked_until, sent_at, created_at, updated_at
FROM reminders;

INSERT INTO delivery_attempts_new (id, reminder_id, attempt_no, twilio_sid, status, error_code, attempted_at)
SELECT id, reminder_id, attempt_no, twilio_sid, status, error_code, attempted_at
FROM delivery_attempts;

INSERT INTO sessions_new (token_hash, user_id, created_at, expires_at)
SELECT token_hash, user_id, created_at, expires_at
FROM sessions;

DROP TABLE delivery_attempts;
DROP TABLE reminders;
DROP TABLE inbound_messages;
DROP TABLE sessions;
DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
ALTER TABLE inbound_messages_new RENAME TO inbound_messages;
ALTER TABLE reminders_new RENAME TO reminders;
ALTER TABLE delivery_attempts_new RENAME TO delivery_attempts;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_reminders_due ON reminders(status, remind_at);
CREATE INDEX idx_reminders_user ON reminders(user_id, remind_at);
CREATE INDEX idx_delivery_reminder ON delivery_attempts(reminder_id);
CREATE INDEX idx_inbound_user ON inbound_messages(user_id, received_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
