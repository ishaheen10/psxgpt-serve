-- Runtime support tables used by the serving Worker outside engine trace logs.
-- Safe to re-run and useful when provisioning a fresh D1 database.

CREATE TABLE IF NOT EXISTS user_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  event_type TEXT NOT NULL,
  event_data TEXT,
  session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_type_created ON user_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS shared_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  session_id TEXT,
  title TEXT,
  message_count INTEGER DEFAULT 0,
  conversation_snapshot TEXT NOT NULL,
  view_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shared_conversations_user_created ON shared_conversations(user_id, created_at DESC);
