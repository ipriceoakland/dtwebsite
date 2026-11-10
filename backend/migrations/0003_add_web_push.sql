CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
);

CREATE INDEX push_subscriptions_by_user ON push_subscriptions(user_id);

CREATE TABLE push_test_limits (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sent_at INTEGER NOT NULL
);
