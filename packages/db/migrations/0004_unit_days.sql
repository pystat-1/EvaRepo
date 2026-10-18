CREATE TABLE `student_day_units` (
	`id` text PRIMARY KEY NOT NULL,
	`studentId` text NOT NULL,
	`dateISO` text NOT NULL,
	`unitId` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_day_units_student_date` ON `student_day_units` (`studentId`,`dateISO`);--> statement-breakpoint
CREATE INDEX `student_day_units_unit` ON `student_day_units` (`unitId`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_name_unique` ON `units` (`name`);--> statement-breakpoint
INSERT INTO `units` (`id`, `name`, `sortOrder`) VALUES ('unit-labour', 'صالة الولادة', 1), ('unit-icu', 'العناية', 2), ('unit-theatre', 'العمليات', 3), ('unit-ward', 'الردهة', 4);
