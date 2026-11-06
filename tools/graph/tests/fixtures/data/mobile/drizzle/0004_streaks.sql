CREATE TABLE `reading_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `streaks` (
	`day` text PRIMARY KEY NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL
);
