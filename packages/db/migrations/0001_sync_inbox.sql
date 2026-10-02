CREATE TABLE `sync_inbox` (
	`clientId` text PRIMARY KEY NOT NULL,
	`relaySeq` integer NOT NULL,
	`evaluatorId` text NOT NULL,
	`groupId` text NOT NULL,
	`dateISO` text NOT NULL,
	`payload` text NOT NULL,
	`receivedAt` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`decidedAt` text NOT NULL,
	`reported` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_inbox_status` ON `sync_inbox` (`status`);--> statement-breakpoint
CREATE INDEX `sync_inbox_seq` ON `sync_inbox` (`relaySeq`);