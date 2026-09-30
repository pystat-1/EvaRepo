-- Criteria in the order and wording of the college's paper form
-- "Daily Evaluation of Hospital Practice", read right to left like the form:
-- Appearance, Punctuality, Attitude & Communication, Discussion & Feedback,
-- Daily Note, then the total. Rows are found by their item keys, so this
-- is a no-op on a database without that rubric.
UPDATE `rubric_sections` SET `sortOrder` = 1, `labelEn` = 'Appearance' WHERE `id` = (SELECT `sectionId` FROM `rubric_items` WHERE `key` = 'badge');
--> statement-breakpoint
UPDATE `rubric_sections` SET `sortOrder` = 2, `labelEn` = 'Punctuality' WHERE `id` = (SELECT `sectionId` FROM `rubric_items` WHERE `key` = 'late');
--> statement-breakpoint
UPDATE `rubric_sections` SET `sortOrder` = 3, `labelEn` = 'Attitude & Communication' WHERE `id` = (SELECT `sectionId` FROM `rubric_items` WHERE `key` = 'pat');
--> statement-breakpoint
UPDATE `rubric_sections` SET `sortOrder` = 4, `labelEn` = 'Discussion & Feedback' WHERE `id` = (SELECT `sectionId` FROM `rubric_items` WHERE `key` = 'cdisc');
--> statement-breakpoint
UPDATE `rubric_sections` SET `sortOrder` = 5, `labelEn` = 'Daily Note' WHERE `id` = (SELECT `sectionId` FROM `rubric_items` WHERE `key` = 'dailynote');
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 1, `labelEn` = 'Badge' WHERE `key` = 'badge';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 2, `labelEn` = 'Coat' WHERE `key` = 'coat';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 3, `labelEn` = 'Uniform' WHERE `key` = 'uni';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 4, `labelEn` = 'Veil' WHERE `key` = 'veil';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 1, `labelEn` = 'Late' WHERE `key` = 'late';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 2, `labelEn` = 'Location' WHERE `key` = 'loc';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 3, `labelEn` = 'Meeting' WHERE `key` = 'meet';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 4, `labelEn` = 'Order Do' WHERE `key` = 'ord';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 1, `labelEn` = 'Patient' WHERE `key` = 'pat';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 2, `labelEn` = 'Teacher' WHERE `key` = 'tchr';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 3, `labelEn` = 'Student' WHERE `key` = 'std';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 4, `labelEn` = 'Staff' WHERE `key` = 'staff';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 1, `labelEn` = 'Case Discussion' WHERE `key` = 'cdisc';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 2, `labelEn` = 'Group Discussion' WHERE `key` = 'gdisc';
--> statement-breakpoint
UPDATE `rubric_items` SET `sortOrder` = 1, `labelEn` = 'Paper' WHERE `key` = 'dailynote';
