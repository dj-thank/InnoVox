-- Synthetic migration fixture using the v0.4 schema from fd9f72a.
-- No current voice_dialogues table or v4 cached-turn envelopes.
CREATE TABLE projects (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE sessions (project TEXT, adapter TEXT, session TEXT, json TEXT NOT NULL, PRIMARY KEY(project,adapter,session));
CREATE TABLE events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT, adapter TEXT, session TEXT, epoch INTEGER, event_id TEXT, sequence INTEGER, digest TEXT, json TEXT,
 UNIQUE(project,adapter,session,epoch,event_id), UNIQUE(project,adapter,session,epoch,sequence));
CREATE TABLE consultations (id TEXT PRIMARY KEY, project TEXT, fingerprint TEXT, json TEXT, UNIQUE(project,fingerprint));
CREATE TABLE deliveries (id TEXT PRIMARY KEY, consultation TEXT UNIQUE, project TEXT, json TEXT);
CREATE TABLE journal (cursor INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, at TEXT, json TEXT);
CREATE TABLE provider_usage (kind TEXT, at INTEGER);
CREATE TABLE voice_state (consultation TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE voice_turns (consultation TEXT, turn_id TEXT, digest TEXT, json TEXT, PRIMARY KEY(consultation,turn_id));
CREATE INDEX event_session ON events(project,adapter,session,epoch,sequence);
PRAGMA user_version=3;
