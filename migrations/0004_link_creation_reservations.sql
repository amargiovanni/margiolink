CREATE TABLE link_creation_reservations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reserved_at INTEGER NOT NULL
);

CREATE INDEX idx_link_creation_reservations_reserved_at
  ON link_creation_reservations (reserved_at);
