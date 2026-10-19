CREATE TABLE `hosted_students` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text,
	`hostGroupId` text NOT NULL,
	`dateISO` text NOT NULL,
	`hospitalId` text,
	`evaluatorId` text NOT NULL,
	`studentId` text,
	`phoneStudentId` text NOT NULL,
	`universityNumber` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`shift` text NOT NULL,
	`homeGroupId` text,
	`homeGroupName` text NOT NULL,
	`priorEvaluation` text,
	`attendance` text NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`record` text NOT NULL,
	`submissionId` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosted_students_day` ON `hosted_students` (`hostGroupId`,`dateISO`,`universityNumber`);--> statement-breakpoint
CREATE INDEX `hosted_students_student` ON `hosted_students` (`studentId`);--> statement-breakpoint
CREATE INDEX `hosted_students_course` ON `hosted_students` (`courseId`);