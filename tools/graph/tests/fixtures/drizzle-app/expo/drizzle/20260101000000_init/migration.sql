CREATE TABLE `notes` (
	`id` text PRIMARY KEY,
	`title` text,
	`body` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
