-- Start with reminders due after activation so overdue reminders do not all fire at once.
CREATE TABLE push_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  activated_at INTEGER NOT NULL
);

INSERT INTO push_schedule (id, activated_at) VALUES (1, unixepoch());

CREATE TABLE push_reminder_deliveries (
  id INTEGER PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  endpoint TEXT REFERENCES push_subscriptions(endpoint) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (reminder_id, endpoint)
);

CREATE INDEX push_deliveries_by_endpoint ON push_reminder_deliveries(endpoint);
