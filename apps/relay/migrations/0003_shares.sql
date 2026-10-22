-- «من الزملاء»: evaluators of the same group send each other a group-day's
-- work (grades, attendance, notes, assignments) to merge before one of
-- them validates the day. The relay only carries the message.

-- Which groups each published bundle holds (filled on every publish): two
-- evaluators are colleagues for a group when both have it.
CREATE TABLE bundle_groups (
  evaluatorId TEXT NOT NULL,
  groupId TEXT NOT NULL,
  PRIMARY KEY (evaluatorId, groupId)
);
CREATE INDEX bundle_groups_group ON bundle_groups (groupId);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  fromId TEXT NOT NULL,
  toId TEXT NOT NULL,
  groupId TEXT NOT NULL,
  dateISO TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new | merged | dismissed
  receivedAt TEXT NOT NULL,
  decidedAt TEXT
);
CREATE INDEX shares_to ON shares (toId, receivedAt);
CREATE INDEX shares_from ON shares (fromId, receivedAt);
