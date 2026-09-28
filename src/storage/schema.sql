CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  directory TEXT NOT NULL,
  agent TEXT, model TEXT, permission TEXT,
  time_created INTEGER, time_updated INTEGER
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  time_created INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS msg_session_idx ON message(session_id, time_created, id);
CREATE TABLE IF NOT EXISTS part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  time_created INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS part_msg_idx ON part(message_id, id);
