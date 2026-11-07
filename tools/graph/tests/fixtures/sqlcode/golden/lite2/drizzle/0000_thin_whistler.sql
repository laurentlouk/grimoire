CREATE TABLE `tags` (
	`user_id` integer NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`user_id`, `tag`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`rate` real DEFAULT 1,
	`rate2` real DEFAULT 0.5,
	`rate3` real DEFAULT 1000,
	`rate4` integer DEFAULT 1000,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_lower` ON `users` (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_displayName_email_unique` ON `users` (`display_name`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `named_u` ON `users` (`display_name`);