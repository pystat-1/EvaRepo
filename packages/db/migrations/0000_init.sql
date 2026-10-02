CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`passwordHash` text,
	`googleId` text,
	`name` text NOT NULL,
	`role` text DEFAULT 'ADMIN' NOT NULL,
	`studentId` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_googleId_unique` ON `accounts` (`googleId`);--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`studentId` text NOT NULL,
	`dateISO` text NOT NULL,
	`groupId` text,
	`hospitalId` text,
	`status` text NOT NULL,
	`markedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`markedById` text NOT NULL,
	`dailyNote` integer,
	`dailyNoteAt` text,
	`dailyNoteById` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_records_student_date` ON `attendance_records` (`studentId`,`dateISO`);--> statement-breakpoint
CREATE INDEX `attendance_records_group_date` ON `attendance_records` (`groupId`,`dateISO`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`actorId`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity` ON `audit_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_log_created` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE TABLE `course_attendance_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`shift` text,
	`studyTypeId` text,
	`daysOfWeek` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studyTypeId`) REFERENCES `study_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `course_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`dateISO` text NOT NULL,
	`label` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_holidays_unique` ON `course_holidays` (`courseId`,`dateISO`);--> statement-breakpoint
CREATE TABLE `course_hospitals` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`hospitalId` text NOT NULL,
	`capacity` integer,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hospitalId`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_hospitals_unique` ON `course_hospitals` (`courseId`,`hospitalId`);--> statement-breakpoint
CREATE TABLE `course_study_types` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`studyTypeId` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studyTypeId`) REFERENCES `study_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_study_types_unique` ON `course_study_types` (`courseId`,`studyTypeId`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`number` integer NOT NULL,
	`label` text,
	`active` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`startDate` text,
	`weekCount` integer,
	`setupStep` integer DEFAULT 1 NOT NULL,
	`scheduleVersion` integer DEFAULT 0 NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_year_number` ON `courses` (`year`,`number`);--> statement-breakpoint
CREATE TABLE `evaluation_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluationId` text NOT NULL,
	`rubricSectionId` text NOT NULL,
	`score` real NOT NULL,
	`labelArAtTime` text,
	`labelEnAtTime` text,
	`maxScoreAtTime` real,
	FOREIGN KEY (`evaluationId`) REFERENCES `evaluations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rubricSectionId`) REFERENCES `rubric_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_scores_unique` ON `evaluation_scores` (`evaluationId`,`rubricSectionId`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`studentId` text NOT NULL,
	`evaluatorId` text NOT NULL,
	`groupId` text,
	`hospitalId` text,
	`dateISO` text NOT NULL,
	`attendance` text NOT NULL,
	`notes` text,
	`feedback` text,
	`dailyNoteSubmitted` integer DEFAULT false NOT NULL,
	`itemScores` text,
	`pendingValidation` integer DEFAULT false NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`courseId` text,
	`rubricVersion` integer,
	`lastSubmissionId` text,
	`lockedAt` text,
	`lockedById` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evaluatorId`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluations_student_date` ON `evaluations` (`studentId`,`dateISO`);--> statement-breakpoint
CREATE INDEX `evaluations_group` ON `evaluations` (`groupId`);--> statement-breakpoint
CREATE INDEX `evaluations_date` ON `evaluations` (`dateISO`);--> statement-breakpoint
CREATE INDEX `evaluations_evaluator` ON `evaluations` (`evaluatorId`);--> statement-breakpoint
CREATE TABLE `evaluator_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`hospitalId` text NOT NULL,
	`groupId` text,
	`courseId` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hospitalId`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evaluator_assignments_account` ON `evaluator_assignments` (`accountId`);--> statement-breakpoint
CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`studentId` text NOT NULL,
	`ruleId` text NOT NULL,
	`severity` text NOT NULL,
	`msg` text NOT NULL,
	`dateISO` text NOT NULL,
	`seen` integer DEFAULT false NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flags_student_rule` ON `flags` (`studentId`,`ruleId`);--> statement-breakpoint
CREATE TABLE `group_work_days` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`dateISO` text NOT NULL,
	`hospitalId` text,
	`scheduled` integer DEFAULT true NOT NULL,
	`startedById` text NOT NULL,
	`startedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`validatedAt` text,
	`validatedById` text,
	`reopenedAt` text,
	`reopenedById` text,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_work_days_group_date` ON `group_work_days` (`groupId`,`dateISO`);--> statement-breakpoint
CREATE INDEX `group_work_days_validated` ON `group_work_days` (`validatedAt`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cycleLabel` text,
	`courseId` text,
	`shift` text,
	`studyTypeId` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studyTypeId`) REFERENCES `study_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `groups_course` ON `groups` (`courseId`);--> statement-breakpoint
CREATE TABLE `hospitals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nameAr` text,
	`address` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rotation_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`hospitalId` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`daysOfWeek` text,
	`notes` text,
	`courseId` text,
	`weekIndex` integer,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hospitalId`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rotation_blocks_group` ON `rotation_blocks` (`groupId`);--> statement-breakpoint
CREATE INDEX `rotation_blocks_hospital` ON `rotation_blocks` (`hospitalId`);--> statement-breakpoint
CREATE INDEX `rotation_blocks_course` ON `rotation_blocks` (`courseId`);--> statement-breakpoint
CREATE TABLE `rubric_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sectionId` text NOT NULL,
	`key` text NOT NULL,
	`labelAr` text NOT NULL,
	`labelEn` text,
	`maxScore` real NOT NULL,
	`kind` text DEFAULT 'number' NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`sectionId`) REFERENCES `rubric_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_items_key_unique` ON `rubric_items` (`key`);--> statement-breakpoint
CREATE INDEX `rubric_items_section` ON `rubric_items` (`sectionId`);--> statement-breakpoint
CREATE TABLE `rubric_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`labelAr` text NOT NULL,
	`labelEn` text,
	`maxScore` real NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`universityNumber` text NOT NULL,
	`nameAr` text NOT NULL,
	`nameEn` text,
	`email` text,
	`studyTypeId` text,
	`groupId` text,
	`courseId` text,
	`shift` text,
	`code` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`studyTypeId`) REFERENCES `study_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_universityNumber_unique` ON `students` (`universityNumber`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_code_unique` ON `students` (`code`);--> statement-breakpoint
CREATE INDEX `students_group` ON `students` (`groupId`);--> statement-breakpoint
CREATE INDEX `students_course` ON `students` (`courseId`);--> statement-breakpoint
CREATE INDEX `students_name` ON `students` (`nameAr`);--> statement-breakpoint
CREATE TABLE `study_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nameAr` text,
	`code` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_types_name_unique` ON `study_types` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_types_code_unique` ON `study_types` (`code`);--> statement-breakpoint
CREATE TABLE `term_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`weeksCount` integer,
	`daysPerWeek` integer,
	`weekdays` text,
	`startDate` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
