PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_authors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_authors`("id", "name", "bio") SELECT "id", "name", coalesce("bio", '') FROM `authors`;--> statement-breakpoint
DROP TABLE `authors`;--> statement-breakpoint
ALTER TABLE `__new_authors` RENAME TO `authors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
