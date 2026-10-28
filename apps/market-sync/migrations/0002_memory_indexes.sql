-- Memory/query-log operational indexes for the serving and cron workers.
-- Safe to re-run; used by memory extraction, analyst context loading, and feedback updates.

CREATE TABLE IF NOT EXISTS query_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  session_id TEXT,
  message_id TEXT,
  query TEXT NOT NULL,
  answer TEXT,
  status TEXT,
  iterations INTEGER,
  duration_ms INTEGER,
  error TEXT,
  scout_input_tokens INTEGER,
  scout_output_tokens INTEGER,
  analyst_input_tokens INTEGER,
  analyst_output_tokens INTEGER,
  was_steered INTEGER DEFAULT 0,
  feedback TEXT,
  feedback_comment TEXT,
  feedback_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_query_logs_user_created ON query_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_logs_created_user ON query_logs(created_at DESC, user_id);
CREATE INDEX IF NOT EXISTS idx_query_logs_message_user ON query_logs(message_id, user_id);

CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  first_name TEXT,
  source TEXT DEFAULT 'inferred',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user_source_created ON user_memories(user_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_memories_source_created ON user_memories(source, created_at DESC);
