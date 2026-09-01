-- Reverses migrations/0002_drop_referrer_url.sql.
--
-- This restores the COLUMN but NOT its data, and that is correct: the values
-- were complete third-party URLs that should never have been retained, and
-- bringing them back would undo the minimisation this migration exists to
-- perform. Rows written before the drop come back with `referrer_url` NULL.
ALTER TABLE clicks ADD COLUMN referrer_url TEXT;
