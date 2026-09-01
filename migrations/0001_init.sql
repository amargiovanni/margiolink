CREATE TABLE links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  target_url    TEXT    NOT NULL,
  title         TEXT,
  description   TEXT,
  password_hash TEXT,
  password_salt TEXT,
  expires_at    INTEGER,
  expired_url   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

CREATE INDEX idx_links_created_at ON links (created_at DESC);
CREATE INDEX idx_links_deleted_at ON links (deleted_at);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE link_tags (
  link_id INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);

CREATE INDEX idx_link_tags_tag ON link_tags (tag_id);

CREATE TABLE clicks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id         INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  ts              INTEGER NOT NULL,
  visitor_hash    TEXT    NOT NULL,
  source          TEXT    NOT NULL,
  outcome         TEXT    NOT NULL,
  is_bot          INTEGER NOT NULL DEFAULT 0,
  continent       TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  timezone        TEXT,
  asn_org         TEXT,
  colo            TEXT,
  device_type     TEXT,
  os              TEXT,
  os_version      TEXT,
  browser         TEXT,
  browser_version TEXT,
  language        TEXT,
  referrer_host   TEXT,
  referrer_url    TEXT,
  referrer_type   TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_term        TEXT,
  utm_content     TEXT
);

CREATE INDEX idx_clicks_link_ts ON clicks (link_id, ts);
CREATE INDEX idx_clicks_ts ON clicks (ts);

CREATE TABLE click_daily (
  day     TEXT    NOT NULL,
  link_id INTEGER NOT NULL,
  clicks  INTEGER NOT NULL,
  uniques INTEGER NOT NULL,
  bots    INTEGER NOT NULL,
  PRIMARY KEY (day, link_id)
);

CREATE TABLE click_daily_dim (
  day       TEXT    NOT NULL,
  link_id   INTEGER NOT NULL,
  dimension TEXT    NOT NULL,
  value     TEXT    NOT NULL,
  clicks    INTEGER NOT NULL,
  uniques   INTEGER NOT NULL,
  PRIMARY KEY (day, link_id, dimension, value)
);

CREATE INDEX idx_click_daily_dim_lookup ON click_daily_dim (dimension, day, link_id);

CREATE TABLE admin_sessions (
  id           TEXT    PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ua_summary   TEXT
);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions (expires_at);

CREATE TABLE login_attempts (
  ip_hash          TEXT    PRIMARY KEY,
  attempts         INTEGER NOT NULL,
  first_attempt_at INTEGER NOT NULL,
  locked_until     INTEGER
);
