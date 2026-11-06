DROP INDEX visits_badge_idx;

CREATE VIEW badge_holders AS SELECT code, holder FROM badges;
