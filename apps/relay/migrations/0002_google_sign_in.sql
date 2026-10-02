-- Evaluators sign in on the phone with their Google account (the email the
-- admin registered); no passwords. The relay remembers who has signed in so
-- the desktop can show it.

ALTER TABLE evaluators ADD COLUMN googleName TEXT;
ALTER TABLE evaluators ADD COLUMN lastLoginAt TEXT;

DROP TABLE IF EXISTS login_attempts;
